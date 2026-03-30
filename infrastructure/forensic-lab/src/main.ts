import {
  clearTraceInspectionHistory,
  createTracehound,
  decodeWithIntegrityAsync,
  encodeWithIntegrityAsync,
  generateSecureId,
  getTraceRegistryStats,
  readSystemSnapshotFromDisk,
  recordTraceInspectionEntry,
  SYSTEM_SNAPSHOT_ENV,
  verify,
  writeSystemSnapshotToDisk,
  type HoundResult,
  type RuntimeEvidenceHandle,
  type Scent,
  type SystemSnapshot,
} from '@tracehound/core'
import { createHmac } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createFileColdStorage } from './file-cold-storage.js'

interface LabCheck {
  readonly name: string
  readonly passed: boolean
  readonly details: string
}

interface LabMetadata {
  readonly release: string
  readonly artifactSource: 'workspace'
  readonly buildMode: 'tsc-first'
  readonly commitSha: string
  readonly executedAt: string
  readonly sourcePath: string
  readonly packages: {
    readonly core: string
    readonly cli: string
  }
}

interface CliStatusJson {
  readonly connected?: boolean
  readonly error?: string
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..', '..', '..')

function parseRelease(argv: readonly string[]): string {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--release') {
      const value = argv[index + 1]
      if (typeof value === 'string' && value.length > 0) {
        return value
      }
    }
  }

  return process.env['TRACEHOUND_RELEASE_LABEL'] ?? 'local'
}

function readPackageVersion(packageDir: string): string {
  const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, packageDir, 'package.json'), 'utf8')) as {
    version?: string
  }
  return pkg.version ?? 'unknown'
}

function resolveCommitSha(): string {
  const fromEnv = process.env['GITHUB_SHA']
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    return fromEnv
  }

  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim()
  } catch {
    return 'unknown'
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

async function waitForSnapshot(
  snapshotPath: string,
  secret: string,
  predicate: (snapshot: SystemSnapshot) => boolean = () => true,
): Promise<SystemSnapshot> {
  const deadline = Date.now() + 10_000

  while (Date.now() < deadline) {
    const result = readSystemSnapshotFromDisk(snapshotPath, secret)
    if (result.ok && predicate(result.snapshot)) {
      return result.snapshot
    }
    await sleep(100)
  }

  throw new Error('timed out waiting for signed snapshot')
}

function writeLegacySignedSnapshot(
  snapshotPath: string,
  secret: string,
  snapshot: SystemSnapshot,
): void {
  const legacyPayload = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>
  delete legacyPayload['pressure']

  const watcher = legacyPayload['watcher']
  if (watcher && typeof watcher === 'object') {
    delete (watcher as Record<string, unknown>)['pressure']
  }

  const payloadText = JSON.stringify(legacyPayload)
  const signed = {
    version: 1,
    algorithm: 'HMAC-SHA256',
    payload: legacyPayload,
    signature: createHmac('sha256', secret).update(payloadText).digest('hex'),
  }
  writeFileSync(snapshotPath, JSON.stringify(signed), 'utf8')
}

function runCliStatus(snapshotPath: string, secret: string, env: Record<string, string>): CliStatusJson {
  const stdout = execFileSync(
    'node',
    [resolve(REPO_ROOT, 'packages', 'cli', 'dist', 'index.js'), 'status', '--json'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...env,
        NODE_ENV: 'cli-run',
        [SYSTEM_SNAPSHOT_ENV.PATH]: snapshotPath,
        [SYSTEM_SNAPSHOT_ENV.SECRET]: secret,
      },
    },
  )

  return JSON.parse(stdout) as CliStatusJson
}

function createThreatScent(id: string, severity: 'low' | 'medium' | 'high' | 'critical'): Scent {
  return {
    id,
    timestamp: Date.now(),
    source: {
      ip: '203.0.113.10',
      userAgent: 'tracehound-forensic-lab/1.8.9',
    },
    payload: {
      method: 'POST',
      path: '/forensic-lab',
      body: {
        id,
        attack: 'sql',
      },
    },
    threat: {
      category: 'injection',
      severity,
    },
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function main(): Promise<void> {
  const release = parseRelease(process.argv.slice(2))
  const outputRoot = resolve(REPO_ROOT, 'test-results', release, 'forensic-lab')
  const runtimeRoot = resolve(outputRoot, 'runtime')
  const snapshotPath = resolve(runtimeRoot, 'snapshot', 'system-snapshot.json')
  const traceRegistryPath = resolve(runtimeRoot, 'trace', 'trace-registry.ndjson')
  const coldStorageDir = resolve(runtimeRoot, 'cold-storage')
  const secret = `tracehound-forensic-lab-${release}-secret`

  rmSync(outputRoot, { recursive: true, force: true })
  mkdirSync(resolve(runtimeRoot, 'snapshot'), { recursive: true })
  mkdirSync(resolve(runtimeRoot, 'trace'), { recursive: true })
  mkdirSync(coldStorageDir, { recursive: true })

  const metadata: LabMetadata = {
    release,
    artifactSource: 'workspace',
    buildMode: 'tsc-first',
    commitSha: resolveCommitSha(),
    executedAt: new Date().toISOString(),
    sourcePath: REPO_ROOT,
    packages: {
      core: readPackageVersion('packages/core'),
      cli: readPackageVersion('packages/cli'),
    },
  }

  process.env['TRACEHOUND_RELEASE_LABEL'] = release
  process.env[SYSTEM_SNAPSHOT_ENV.PATH] = snapshotPath
  process.env[SYSTEM_SNAPSHOT_ENV.SECRET] = secret
  process.env['TRACEHOUND_TRACE_REGISTRY_PATH'] = traceRegistryPath

  const coldStorage = createFileColdStorage(coldStorageDir)
  const checks: LabCheck[] = []
  const houndResults: HoundResult[] = []

  const tracehound = createTracehound({
    coldStorage,
    maxPayloadSize: 64_000,
    quarantine: {
      maxCount: 4,
      maxBytes: 32_000,
      ttlMs: 10_000,
      decayIntervalMs: 1_000,
      decayBatchSize: 4,
    },
    watcher: {
      maxAlertsPerWindow: 10,
      alertWindowMs: 60_000,
      quarantineHighWatermark: 0.25,
    },
    pressure: {
      elevatedWatermark: 0.25,
      criticalWatermark: 0.5,
      recoverToElevatedWatermark: 0.4,
      recoverToNormalWatermark: 0.1,
      recoveryCooldownMs: 25,
    },
    houndPool: {
      poolSize: 2,
      timeout: 5_000,
    },
    snapshot: {
      path: snapshotPath,
      secret,
      intervalMs: 100,
    },
  })

  tracehound.houndPool.onResult((result) => {
    houndResults.push(result)
  })

  try {
    const first = tracehound.agent.intercept(createThreatScent(generateSecureId(), 'high'))
    if (first.status !== 'quarantined') {
      throw new Error(`expected first threat to be quarantined, received ${first.status}`)
    }
    const handle = first.handle

    const second = tracehound.agent.intercept(createThreatScent(generateSecureId(), 'critical'))
    if (second.status !== 'quarantined') {
      throw new Error(`expected second threat to be quarantined, received ${second.status}`)
    }
    const secondHandle = second.handle

    const snapshot = await waitForSnapshot(
      snapshotPath,
      secret,
      (candidate) => candidate.pressure.signals.quarantineCount >= 2,
    )
    checks.push({
      name: 'signed_snapshot_readback',
      passed: snapshot.systemHealth === 'healthy' || snapshot.systemHealth === 'degraded' || snapshot.systemHealth === 'critical',
      details: `snapshot written at ${snapshot.generatedAt} and verified with HMAC`,
    })

    const quarantinedEvidence = tracehound.quarantine.get(handle.signature)
    if (quarantinedEvidence === null) {
      throw new Error('expected quarantine evidence to remain available for parity checks')
    }
    const originalBytes = new Uint8Array(quarantinedEvidence.bytes)
    const encoded = await encodeWithIntegrityAsync(originalBytes)
    const writeResult = await coldStorage.write(handle.signature, encoded)
    assert(writeResult.success, 'cold storage write failed')
    const readResult = await coldStorage.read(handle.signature)
    assert(readResult.success, 'cold storage read failed')
    const archivedPayload = readResult.payload
    if (archivedPayload === undefined) {
      throw new Error('cold storage payload missing after successful read')
    }
    assert(verify(archivedPayload), 'cold storage integrity verification failed')
    const decoded = await decodeWithIntegrityAsync(archivedPayload)
    const parityOk = Buffer.from(decoded).equals(Buffer.from(originalBytes))
    checks.push({
      name: 'cold_storage_parity',
      passed: parityOk,
      details: `cold storage bytes matched quarantined evidence for ${handle.signature}`,
    })

    let membraneBlocked = false
    try {
      void (handle as RuntimeEvidenceHandle).bytes
    } catch {
      membraneBlocked = true
    }
    checks.push({
      name: 'runtime_membrane_block',
      passed: membraneBlocked,
      details: `runtime handle membrane=${handle.membrane}`,
    })

    clearTraceInspectionHistory({
      path: traceRegistryPath,
      maxEntries: 2,
      maxQueueEntries: 2,
    })
    for (let index = 0; index < 10; index += 1) {
      recordTraceInspectionEntry(
        {
          traceId: `trace-${index}`,
          signature: `injection:${index}`,
          severity: 'medium',
          size: 256,
          captured: Date.now(),
          source: '203.0.113.20',
        },
        {
          path: traceRegistryPath,
          maxEntries: 2,
          maxQueueEntries: 2,
        },
      )
    }
    await sleep(50)
    const registryStats = getTraceRegistryStats({
      path: traceRegistryPath,
      maxEntries: 2,
      maxQueueEntries: 2,
    })
    checks.push({
      name: 'trace_registry_bounded',
      passed: registryStats.retainedEntries <= 2 && registryStats.droppedCount > 0,
      details: `retained=${registryStats.retainedEntries} dropped=${registryStats.droppedCount}`,
    })

    checks.push({
      name: 'pressure_transition_evidence',
      passed:
        tracehound.snapshot().pressure.mode !== 'normal' &&
        tracehound.snapshot().pressure.signals.quarantineCount >= 2,
      details: `pressureMode=${tracehound.snapshot().pressure.mode} count=${tracehound.snapshot().pressure.signals.quarantineCount}`,
    })

    const houndDeadline = Date.now() + 5_000
    while (Date.now() < houndDeadline && houndResults.length === 0) {
      await sleep(50)
    }
    checks.push({
      name: 'hound_result_custody',
      passed: houndResults.some((result) => result.signature === handle.signature),
      details: `hound results observed=${houndResults.length}`,
    })

    const purgeRecord = tracehound.quarantine.purge(secondHandle.signature, 'panic')
    const auditVerified = tracehound.auditChain.verify()
    checks.push({
      name: 'audit_chain_continuity',
      passed: purgeRecord !== null && tracehound.auditChain.length > 0 && auditVerified,
      details: `audit records=${tracehound.auditChain.length} verify=${auditVerified} purgeRecord=${purgeRecord !== null}`,
    })

    writeSystemSnapshotToDisk(
      {
        ...snapshot,
        generatedAt: snapshot.generatedAt - 60_000,
      },
      snapshotPath,
      secret,
    )
    const staleStatus = runCliStatus(snapshotPath, secret, {
      [SYSTEM_SNAPSHOT_ENV.MAX_AGE_MS]: '1000',
      [SYSTEM_SNAPSHOT_ENV.MAX_FUTURE_SKEW_MS]: '5000',
    })
    checks.push({
      name: 'cli_stale_snapshot_truth',
      passed: staleStatus.connected === false && staleStatus.error === 'NO_INSTANCE',
      details: `cli stale snapshot error=${staleStatus.error ?? 'unknown'}`,
    })

    writeSystemSnapshotToDisk(
      {
        ...snapshot,
        generatedAt: Date.now() + 60_000,
      },
      snapshotPath,
      secret,
    )
    const futureStatus = runCliStatus(snapshotPath, secret, {
      [SYSTEM_SNAPSHOT_ENV.MAX_AGE_MS]: '5000',
      [SYSTEM_SNAPSHOT_ENV.MAX_FUTURE_SKEW_MS]: '1000',
    })
    checks.push({
      name: 'cli_future_snapshot_truth',
      passed: futureStatus.connected === false && futureStatus.error === 'INTEGRITY_VIOLATION',
      details: `cli future snapshot error=${futureStatus.error ?? 'unknown'}`,
    })

    writeLegacySignedSnapshot(snapshotPath, secret, snapshot)
    const legacyRead = readSystemSnapshotFromDisk(snapshotPath, secret)
    checks.push({
      name: 'legacy_snapshot_compatibility',
      passed: legacyRead.ok && legacyRead.snapshot.pressure.mode === 'normal',
      details: legacyRead.ok
        ? `legacy snapshot normalized with pressure mode ${legacyRead.snapshot.pressure.mode}`
        : `legacy snapshot failed with ${legacyRead.reason}`,
    })

    const summary = {
      metadata,
      checks,
      houndResults: houndResults.map((result) => ({
        signature: result.signature,
        status: result.status,
        durationMs: result.durationMs,
        processId: result.processId,
      })),
      snapshotPath,
      traceRegistryPath,
      coldStorageDir,
    }

    writeFileSync(resolve(outputRoot, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8')
    writeFileSync(
      resolve(outputRoot, 'summary.md'),
      [
        '# Tracehound Forensic Lab',
        '',
        `- Release: ${metadata.release}`,
        `- Build mode: ${metadata.buildMode}`,
        `- Artifact source: ${metadata.artifactSource}`,
        `- Commit: ${metadata.commitSha}`,
        '',
        ...checks.map((check) =>
          `- [${check.passed ? 'x' : ' '}] ${check.name}: ${check.details}`,
        ),
        '',
      ].join('\n'),
      'utf8',
    )

    const failed = checks.filter((check) => !check.passed)
    if (failed.length > 0) {
      throw new Error(`forensic lab failed: ${failed.map((check) => check.name).join(', ')}`)
    }
  } finally {
    tracehound.shutdown()
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`[forensic-lab] ${toMessage(error)}\n`)
  process.exit(1)
})
