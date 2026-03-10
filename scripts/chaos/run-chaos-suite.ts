import { readSystemSnapshotFromDisk } from '@tracehound/core'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '../..')
const COMPOSE_FILE = resolve(REPO_ROOT, 'infrastructure/chaos/docker-compose.yml')
const CHAOS_DATA_DIR = resolve(REPO_ROOT, 'infrastructure/chaos/data')
const HOST_SNAPSHOT_PATH = resolve(CHAOS_DATA_DIR, 'snapshot/system-snapshot.json')
const HOST_TRACE_REGISTRY_PATH = resolve(CHAOS_DATA_DIR, 'trace/trace-registry.ndjson')
const COMPOSE_PROJECT_NAME = 'tracehound-chaos'

const TARGET_SERVICE = 'target-app'
const BASE_URL = 'http://127.0.0.1:3000'
const TARGET_URL = `${BASE_URL}/api/data`
const HEALTH_URL = `${BASE_URL}/api/health`
const RUNTIME_URL = `${BASE_URL}/api/chaos/runtime`

const CONTAINER_SNAPSHOT_PATH = '/app/data/snapshot/system-snapshot.json'
const CONTAINER_TRACE_REGISTRY_PATH = '/app/data/trace/trace-registry.ndjson'

const POOL_TIMEOUT_MS = 100
const POOL_SIZE = 2
const SNAPSHOT_INTERVAL_MS = 250
const LARGE_BODY_BYTES = 256_000
const CLEAN_TRAFFIC_SAMPLES = 4
const CLEAN_P95_BUDGET_MS = 2_000

interface DataRequestResult {
  readonly status: number
  readonly duration: number
  readonly traceId: string | null
  readonly error?: string
}

interface ChaosRuntimeState {
  readonly status: 'ok'
  readonly snapshot: {
    readonly systemHealth: 'healthy' | 'degraded' | 'critical'
    readonly watcher: {
      readonly overloaded: boolean
      readonly totalAlerts: number
      readonly alertsInWindow: number
    }
    readonly houndPool: {
      readonly activeProcesses: number
      readonly totalProcesses: number
      readonly totalTimeouts: number
      readonly totalErrors: number
    }
  }
  readonly notifications: {
    readonly totalEmitted: number
  }
  readonly traceRegistry: {
    readonly fileExists: boolean
    readonly retainedEntries: number
    readonly uniqueTraceIds: number
    readonly droppedCount: number
    readonly queueDepth: number
    readonly blocked: boolean
    readonly latestEntries: ReadonlyArray<{
      readonly traceId: string
      readonly signature: string
      readonly severity: 'low' | 'medium' | 'high' | 'critical'
      readonly recordedAt: number
    }>
  }
  readonly recentPanics: ReadonlyArray<{
    readonly timestamp: number
    readonly level: 'warning' | 'critical' | 'fatal'
    readonly reason: string
  }>
}

const state = {
  requestCounter: 0,
  infrastructureStarted: false,
  infrastructureCleanedUp: false,
  cleanupInProgress: false,
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const candidate = error as { message?: unknown }
    if (typeof candidate.message === 'string' && candidate.message.length > 0) {
      return candidate.message
    }
  }

  return 'unknown_error'
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) {
    return 0
  }

  const normalizedRatio = Math.min(1, Math.max(0, ratio))
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * normalizedRatio) - 1)
  return sorted[Math.max(0, index)] ?? 0
}

function hasTraceRegistryEntry(runtime: ChaosRuntimeState, traceId: string): boolean {
  return runtime.traceRegistry.latestEntries.some((entry) => entry.traceId === traceId)
}

async function waitForTraceObservation(
  traceId: string,
  previousUniqueTraceIds: number,
  timeoutMs = 5_000,
): Promise<ChaosRuntimeState | null> {
  let observedRuntime: ChaosRuntimeState | null = null

  const observed = await waitForCondition(
    `trace registry observation for ${traceId}`,
    async () => {
      const runtime = await tryFetchRuntimeState()
      if (
        runtime !== null &&
        runtime.traceRegistry.uniqueTraceIds > previousUniqueTraceIds &&
        hasTraceRegistryEntry(runtime, traceId)
      ) {
        observedRuntime = runtime
        return true
      }

      return false
    },
    timeoutMs,
    200,
  )

  return observed ? observedRuntime : null
}

function ensureDockerReady(): void {
  try {
    execFileSync('docker', ['info'], { stdio: 'pipe' })
  } catch (error: unknown) {
    console.error('\n[Preflight] Docker daemon is not reachable.')
    console.error('Start Docker Desktop (Linux engine) and retry `pnpm test:chaos`.')
    console.error(`Details: ${toErrorMessage(error)}`)
    process.exit(1)
  }

  try {
    execFileSync('docker', ['compose', 'version'], { stdio: 'pipe' })
  } catch (error: unknown) {
    console.error('\n[Preflight] Docker Compose v2 is required but not available.')
    console.error('Install/enable Docker Compose v2 and retry `pnpm test:chaos`.')
    console.error(`Details: ${toErrorMessage(error)}`)
    process.exit(1)
  }
}

function prepareEnvironment(): string {
  process.env['COMPOSE_PROJECT_NAME'] = COMPOSE_PROJECT_NAME
  process.env['TRACEHOUND_SNAPSHOT_SECRET'] =
    process.env['TRACEHOUND_SNAPSHOT_SECRET'] ?? `${randomUUID()}-${randomUUID()}`
  process.env['TRACEHOUND_SYSTEM_SNAPSHOT_PATH'] = CONTAINER_SNAPSHOT_PATH
  process.env['TRACEHOUND_TRACE_REGISTRY_PATH'] = CONTAINER_TRACE_REGISTRY_PATH

  return process.env['TRACEHOUND_SNAPSHOT_SECRET']
}

function resetHostChaosData(): void {
  try {
    rmSync(CHAOS_DATA_DIR, { force: true, recursive: true })
    mkdirSync(resolve(CHAOS_DATA_DIR, 'snapshot'), { recursive: true })
    mkdirSync(resolve(CHAOS_DATA_DIR, 'trace'), { recursive: true })
    // Pre-create as empty files so the bind-mount exposes files from the start
    // and fault injection in Tests 3/4 cannot leave directories at these paths
    // across test runs.
    writeFileSync(HOST_SNAPSHOT_PATH, '')
    writeFileSync(HOST_TRACE_REGISTRY_PATH, '')
  } catch (error: unknown) {
    console.error(`[Setup] Failed to reset host chaos data: ${toErrorMessage(error)}`)
  }
}

function runDocker(args: readonly string[], inherit = false): string {
  const result = execFileSync('docker', args, {
    cwd: REPO_ROOT,
    stdio: inherit ? 'inherit' : 'pipe',
    env: process.env,
  })

  return result === null ? '' : typeof result === 'string' ? result : result.toString('utf8')
}

function dockerCompose(args: readonly string[], inherit = false): string {
  return runDocker(['compose', '-f', COMPOSE_FILE, ...args], inherit)
}

function listChaosContainers(): string[] {
  try {
    const output = runDocker([
      'ps',
      '-aq',
      '--filter',
      `label=com.docker.compose.project=${COMPOSE_PROJECT_NAME}`,
    ])

    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  } catch {
    return []
  }
}

function cleanupInfrastructure(): void {
  if (state.cleanupInProgress) {
    return
  }

  const knownContainers = listChaosContainers()
  if (
    !state.infrastructureStarted &&
    state.infrastructureCleanedUp &&
    knownContainers.length === 0
  ) {
    return
  }

  state.cleanupInProgress = true
  console.log('\n[Teardown] Cleaning up infrastructure...')

  try {
    dockerCompose(['down', '-v', '--remove-orphans'], true)
  } catch (error: unknown) {
    console.error(`[Teardown] Failed to stop chaos infrastructure: ${toErrorMessage(error)}`)
  }

  const remainingContainers = listChaosContainers()
  if (remainingContainers.length > 0) {
    console.error(
      `[Teardown] Compose left ${remainingContainers.length} container(s) behind. Forcing removal...`,
    )

    try {
      runDocker(['rm', '-f', ...remainingContainers], true)
    } catch (error: unknown) {
      console.error(`[Teardown] Forced container removal failed: ${toErrorMessage(error)}`)
    }
  }

  const finalContainers = listChaosContainers()
  state.infrastructureStarted = false
  state.infrastructureCleanedUp = finalContainers.length === 0
  state.cleanupInProgress = false

  if (!state.infrastructureCleanedUp) {
    console.error(
      `[Teardown] Chaos infrastructure is still present after cleanup: ${finalContainers.join(', ')}`,
    )
  }
}

function resetDanglingInfrastructure(): void {
  console.log('[Setup] Clearing any previous chaos infrastructure...')

  try {
    dockerCompose(['down', '-v', '--remove-orphans'], true)
  } catch {
    // A previous stack may not exist. Ignore and continue.
  }

  resetHostChaosData()
}

function execInTarget(cmd: string): string {
  try {
    return dockerCompose(['exec', '-T', TARGET_SERVICE, 'sh', '-c', cmd]).trim()
  } catch {
    return ''
  }
}

async function sendRequest(
  isThreat: boolean,
  bodyBytes = 0,
  timeoutMs = 5_000,
): Promise<DataRequestResult> {
  const start = Date.now()
  state.requestCounter += 1
  const requestId = `chaos-${state.requestCounter}-${randomUUID()}`
  const payload =
    bodyBytes > 0
      ? {
          id: requestId,
          chaos: isThreat,
          padding: 'x'.repeat(bodyBytes),
        }
      : {
          id: requestId,
          chaos: isThreat,
        }

  try {
    const response = await fetch(TARGET_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': requestId,
        ...(isThreat ? { 'x-chaos-threat': 'true' } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
    await response.text()

    return {
      status: response.status,
      duration: Date.now() - start,
      traceId: response.headers.get('x-tracehound-trace-id'),
    }
  } catch (error: unknown) {
    return {
      status: 0,
      duration: Date.now() - start,
      traceId: null,
      error: toErrorMessage(error),
    }
  }
}

async function fetchRuntimeState(): Promise<ChaosRuntimeState> {
  const response = await fetch(RUNTIME_URL, {
    method: 'GET',
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) {
    throw new Error(`runtime endpoint returned HTTP ${response.status}`)
  }

  return (await response.json()) as ChaosRuntimeState
}

async function tryFetchRuntimeState(): Promise<ChaosRuntimeState | null> {
  try {
    return await fetchRuntimeState()
  } catch {
    return null
  }
}

async function waitForServer(): Promise<void> {
  process.stdout.write('Waiting for target-app server to be ready...')

  const ready = await waitForCondition(
    'target-app health',
    async () => {
      try {
        const response = await fetch(HEALTH_URL, {
          method: 'GET',
          signal: AbortSignal.timeout(2_000),
        })
        if (response.ok) {
          process.stdout.write(' Ready!\n')
          return true
        }
      } catch {
        // Continue polling.
      }

      process.stdout.write('.')
      return false
    },
    60_000,
    1_500,
  )

  if (!ready) {
    console.error('\nFailed to connect to target-app after 60s.')
    process.exit(1)
  }
}

async function waitForCondition(
  label: string,
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true
    }

    await sleep(intervalMs)
  }

  console.error(`  Condition timed out: ${label}`)
  return false
}

console.log('--- Tracehound Local Chaos & Invariant Verification Suite ---\n')

async function runTests(): Promise<void> {
  ensureDockerReady()
  const snapshotSecret = prepareEnvironment()
  resetDanglingInfrastructure()

  console.log('[Setup] Bringing up testing infrastructure...')
  let failedTests = 0

  try {
    dockerCompose(['up', '-d', '--build'], true)
    state.infrastructureStarted = true
    state.infrastructureCleanedUp = false
    await waitForServer()

    console.log('\n[Test 0] Signed snapshot export is live')
    const snapshotReady = await waitForCondition(
      'signed snapshot export',
      async () => {
        if (!existsSync(HOST_SNAPSHOT_PATH)) {
          return false
        }

        const result = readSystemSnapshotFromDisk(HOST_SNAPSHOT_PATH, snapshotSecret)
        return result.ok
      },
      10_000,
      250,
    )
    if (!snapshotReady) {
      console.error('  ❌ FAILED: Snapshot file was not written and verified.')
      failedTests += 1
    } else {
      const snapshot = readSystemSnapshotFromDisk(HOST_SNAPSHOT_PATH, snapshotSecret)
      const health = snapshot.ok ? snapshot.snapshot.systemHealth : 'unknown'
      console.log(`  ✅ PASSED: Snapshot file is signed and readable. System health=${health}`)
    }

    console.log(
      '\n[Test 1] Quarantined requests emit opaque trace ids and persist inspection entries',
    )
    const traceBaseline = (await fetchRuntimeState()).traceRegistry.uniqueTraceIds
    const traceSeed = await sendRequest(true)
    const traceObserved =
      traceSeed.status === 403 && traceSeed.traceId !== null
        ? await waitForTraceObservation(traceSeed.traceId, traceBaseline)
        : null

    if (traceObserved !== null && traceSeed.traceId !== null) {
      console.log(
        `  ✅ PASSED: Quarantined response emitted traceId=${traceSeed.traceId} and registry uniqueTraceIds=${traceObserved.traceRegistry.uniqueTraceIds}.`,
      )
    } else {
      console.error(
        `  ❌ FAILED: Expected HTTP 403 with visible trace output for quarantined request. status=${traceSeed.status}, traceId=${traceSeed.traceId ?? 'null'}`,
      )
      failedTests += 1
    }

    console.log(
      '\n[Test 2] Mixed-plane pressure preserves clean latency and recovers trace emission',
    )
    const flood = Array.from({ length: POOL_SIZE + 4 }, () =>
      sendRequest(true, LARGE_BODY_BYTES, 8_000),
    )
    await sleep(50)
    const cleanDuringPressure: DataRequestResult[] = []
    for (let sample = 0; sample < CLEAN_TRAFFIC_SAMPLES; sample += 1) {
      cleanDuringPressure.push(await sendRequest(false, 0, 4_000))
      await sleep(25)
    }
    const floodResults = await Promise.all(flood)
    await sleep(POOL_TIMEOUT_MS + 250)

    let runtimeAfterPressureCapture: ChaosRuntimeState | null = null
    const runtimeRecoveredAfterPressure = await waitForCondition(
      'runtime endpoint after mixed pressure burst',
      async () => {
        runtimeAfterPressureCapture = await tryFetchRuntimeState()
        return runtimeAfterPressureCapture !== null
      },
      15_000,
      250,
    )
    const runtimeAfterPressure = runtimeAfterPressureCapture as ChaosRuntimeState | null
    const pressureObserved =
      runtimeAfterPressure !== null &&
      (runtimeAfterPressure.snapshot.houndPool.totalTimeouts > 0 ||
        runtimeAfterPressure.snapshot.houndPool.totalErrors > 0 ||
        runtimeAfterPressure.recentPanics.some((panic) => panic.reason.startsWith('hound_')))
    const cleanStatusesHealthy = cleanDuringPressure.every((result) => result.status === 200)
    const cleanP95 = percentile(
      cleanDuringPressure.map((result) => result.duration),
      0.95,
    )
    const floodTraceIds = floodResults.filter((result) => result.traceId !== null).length
    const floodStatuses = floodResults.map((result) => result.status).join(', ')

    const recovered = await waitForCondition(
      'hound pool recovery',
      async () => {
        const runtime = await tryFetchRuntimeState()
        if (runtime === null) {
          return false
        }

        return (
          !runtime.snapshot.watcher.overloaded &&
          runtime.snapshot.houndPool.activeProcesses < runtime.snapshot.houndPool.totalProcesses
        )
      },
      10_000,
      250,
    )
    const recoveryRuntime = recovered ? await tryFetchRuntimeState() : null
    const traceAfterRecoveryBaseline = recoveryRuntime?.traceRegistry.uniqueTraceIds ?? -1
    const recoveryTrace = recoveryRuntime !== null ? await sendRequest(true) : null
    const recoveryTraceObserved =
      recoveryTrace !== null &&
      recoveryTrace.status === 403 &&
      recoveryTrace.traceId !== null &&
      traceAfterRecoveryBaseline >= 0
        ? await waitForTraceObservation(recoveryTrace.traceId, traceAfterRecoveryBaseline)
        : null

    console.log(
      `  Mixed pressure: cleanP95=${cleanP95}ms, cleanStatuses=${cleanDuringPressure.map((result) => result.status).join(', ')}, floodStatuses=${floodStatuses}, floodTraceHeaders=${floodTraceIds}, runtimeRecovered=${runtimeRecoveredAfterPressure}`,
    )
    if (
      pressureObserved &&
      cleanStatusesHealthy &&
      cleanP95 <= CLEAN_P95_BUDGET_MS &&
      recovered &&
      recoveryTraceObserved !== null
    ) {
      console.log(
        '  ✅ PASSED: Clean traffic stayed inside budget, pressure was observed, and trace emission recovered.',
      )
    } else {
      console.error(
        `  ❌ FAILED: Mixed-plane invariant broke. pressureObserved=${pressureObserved}, cleanStatusesHealthy=${cleanStatusesHealthy}, cleanP95=${cleanP95}, recovered=${recovered}, recoveryTraceStatus=${recoveryTrace?.status ?? 'n/a'}, recoveryTraceId=${recoveryTrace?.traceId ?? 'null'}`,
      )
      failedTests += 1
    }

    const runtimeBeforeSinkTests = await tryFetchRuntimeState()
    if (runtimeBeforeSinkTests === null) {
      console.error('\n[Test 3/4] Skipped: runtime became unreachable after mixed-plane pressure.')
      failedTests += 1
    } else {
      console.log('\n[Test 3] Trace registry sink failure stays fail-open and increments drops')
      await waitForCondition(
        'trace registry seed file',
        async () => {
          const runtime = await tryFetchRuntimeState()
          return runtime?.traceRegistry.fileExists ?? false
        },
        5_000,
        200,
      )
      const registryBaseline = runtimeBeforeSinkTests.traceRegistry.droppedCount
      execInTarget(
        `rm -f '${CONTAINER_TRACE_REGISTRY_PATH}' && mkdir -p '${CONTAINER_TRACE_REGISTRY_PATH}'`,
      )

      const traceFailureResponse = await sendRequest(true)
      const registryDropped = await waitForCondition(
        'trace registry dropped count increase',
        async () => {
          const runtime = await tryFetchRuntimeState()
          return (runtime?.traceRegistry.droppedCount ?? registryBaseline) > registryBaseline
        },
        5_000,
        200,
      )

      console.log(
        `  Quarantined response under registry failure: HTTP ${traceFailureResponse.status} (${traceFailureResponse.duration}ms), traceId=${traceFailureResponse.traceId ?? 'null'}`,
      )
      if (
        traceFailureResponse.status === 403 &&
        traceFailureResponse.traceId !== null &&
        registryDropped
      ) {
        console.log('  ✅ PASSED: Trace registry writes failed without taking down the host.')
      } else {
        console.error(
          `  ❌ FAILED: Registry sink failure was not observed safely. status=${traceFailureResponse.status}, traceId=${traceFailureResponse.traceId ?? 'null'}, droppedObserved=${registryDropped}`,
        )
        failedTests += 1
      }

      // Restore the trace registry path so the app can resume writing before teardown.
      execInTarget(`rm -rf '${CONTAINER_TRACE_REGISTRY_PATH}'`)

      console.log('\n[Test 4] Snapshot write failure emits panic while health stays reachable')
      execInTarget(`rm -f '${CONTAINER_SNAPSHOT_PATH}' && mkdir -p '${CONTAINER_SNAPSHOT_PATH}'`)

      const snapshotFailureObserved = await waitForCondition(
        'snapshot_write_failed panic',
        async () => {
          const runtime = await tryFetchRuntimeState()
          return (
            runtime?.recentPanics.some((panic) => panic.reason === 'snapshot_write_failed') ?? false
          )
        },
        10_000,
        SNAPSHOT_INTERVAL_MS,
      )
      const healthResponse = await fetch(HEALTH_URL, {
        method: 'GET',
        signal: AbortSignal.timeout(2_000),
      })
      const snapshotRead = readSystemSnapshotFromDisk(HOST_SNAPSHOT_PATH, snapshotSecret)

      if (snapshotFailureObserved && healthResponse.ok && !snapshotRead.ok) {
        console.log(
          `  ✅ PASSED: Snapshot failure was observed (${snapshotRead.reason}) and the application stayed healthy.`,
        )
      } else {
        console.error(
          `  ❌ FAILED: Snapshot failure invariant did not hold. observed=${snapshotFailureObserved}, health=${healthResponse.status}, snapshotReadOk=${snapshotRead.ok}`,
        )
        failedTests += 1
      }

      // Restore the snapshot path and wait for the app to produce a valid
      // signed snapshot before teardown, so the report file is readable.
      execInTarget(`rm -rf '${CONTAINER_SNAPSHOT_PATH}'`)
      await waitForCondition(
        'snapshot restore after Test 4',
        () => {
          const result = readSystemSnapshotFromDisk(HOST_SNAPSHOT_PATH, snapshotSecret)
          return Promise.resolve(result.ok)
        },
        SNAPSHOT_INTERVAL_MS * 10,
        SNAPSHOT_INTERVAL_MS,
      )
    }
  } finally {
    cleanupInfrastructure()
  }

  if (failedTests > 0) {
    console.error(`\n❌ Chaos Suite finished with ${failedTests} failing invariant(s).`)
    process.exit(1)
  }

  console.log(
    '\n✅ All Chaos Invariants PASSED. Tracehound remains fail-open under controlled chaos.',
  )
}

process.once('SIGINT', () => {
  cleanupInfrastructure()
  process.exit(130)
})

process.once('SIGTERM', () => {
  cleanupInfrastructure()
  process.exit(143)
})

process.once('uncaughtException', (error: Error) => {
  console.error('Unhandled exception running chaos tests:', error.message)
  cleanupInfrastructure()
  process.exit(1)
})

process.once('unhandledRejection', (error: unknown) => {
  console.error('Unhandled promise rejection running chaos tests:', toErrorMessage(error))
  cleanupInfrastructure()
  process.exit(1)
})

// tsx exits with code 13 if the event loop drains while a top-level await is pending.
// This interval prevents that by keeping at least one active timer alive for the
// duration of the suite, regardless of gaps between async polling operations.
const processHold = setInterval(() => undefined, 1_000)

try {
  await runTests()
} catch (error: unknown) {
  console.error('Unhandled error running chaos tests:', toErrorMessage(error))
  process.exit(1)
} finally {
  clearInterval(processHold)
}
