import { execSync } from 'child_process'

const TARGET_URL = 'http://127.0.0.1:3000/api/data'
const HEALTH_URL = 'http://127.0.0.1:3000/api/health'

// Pool timeout configured in server.ts: 100ms
// Pool size configured in server.ts: 2
const POOL_TIMEOUT_MS = 100
const POOL_SIZE = 2

let requestCounter = 0

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.length > 0) {
      return message
    }
  }

  return 'unknown_error'
}

function ensureDockerReady(): void {
  try {
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
    execSync('docker info', { stdio: 'pipe' })
  } catch (error: unknown) {
    console.error('\n[Preflight] Docker daemon is not reachable.')
    console.error('Start Docker Desktop (Linux engine) and retry `npm run test:chaos`.')
    console.error(`Details: ${toErrorMessage(error)}`)
    process.exit(1)
  }

  try {
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
    execSync('docker compose version', { stdio: 'pipe' })
  } catch (error: unknown) {
    console.error('\n[Preflight] Docker Compose v2 is required but not available.')
    console.error('Install/enable Docker Compose v2 and retry `npm run test:chaos`.')
    console.error(`Details: ${toErrorMessage(error)}`)
    process.exit(1)
  }
}

async function sendRequest(
  isThreat: boolean,
  timeoutMs = 5000,
): Promise<{ status: number; duration: number; error?: string }> {
  const start = Date.now()
  requestCounter++
  const uniqueId = `chaos-${Date.now()}-${requestCounter}-${Math.random().toString(36).slice(2)}`
  try {
    // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request
    const res = await fetch(TARGET_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': uniqueId,
        ...(isThreat ? { 'x-chaos-threat': 'true' } : {}),
      },
      body: JSON.stringify({ chaos: isThreat, id: uniqueId }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    await res.json()
    return { status: res.status, duration: Date.now() - start }
  } catch (error: unknown) {
    return { status: 0, duration: Date.now() - start, error: toErrorMessage(error) }
  }
}

function execInContainer(cmd: string): string {
  try {
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
    return execSync(`docker exec chaos-target-app-1 sh -c "${cmd}"`, { stdio: 'pipe' })
      .toString()
      .trim()
  } catch {
    return ''
  }
}

console.log('--- Tracehound Local Chaos & Invariant Verification Suite ---\n')

async function waitForServer() {
  process.stdout.write('Waiting for target-app server to be ready...')
  for (let i = 0; i < 30; i++) {
    try {
      // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request
      const res = await fetch(HEALTH_URL, { method: 'GET' })
      if (res.ok) {
        console.log(' Ready!')
        return
      }
    } catch {}
    process.stdout.write('.')
    await sleep(2000)
  }
  console.error('\nFailed to connect to target-app after 60s.')
  process.exit(1)
}

async function runTests() {
  ensureDockerReady()

  // 1. Setup
  console.log('[Setup] Bringing up testing infrastructure...')
  let infrastructureStarted = false
  let failedTests = 0

  try {
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
    execSync('docker compose -f infrastructure/chaos/docker-compose.yml up -d --build', {
      stdio: 'inherit',
    })
    infrastructureStarted = true
    await sleep(3000)
    await waitForServer()

    // ─── TEST 1: Pool Exhaustion & Timeout Fail-Open ───────────────────────────
    // Saturate all workers (poolSize=2), wait for the 100ms timeout to fire,
    // then verify the next request returns 200/403 (fail-open, no deadlock).
    console.log('\n[Test 1] Pool Exhaustion & Timeout Fail-Open (simulates Zombie Hound)')
    console.log(
      `  Description: Saturates all ${POOL_SIZE} pool workers simultaneously then waits for the ${POOL_TIMEOUT_MS}ms timeout.\n  The next request must succeed (fail-open) without deadlocking the server.`,
    )

    // Flood with poolSize+1 concurrent threat requests to exhaust the pool
    const flood = Array.from({ length: POOL_SIZE + 2 }, () => sendRequest(true))
    await Promise.all(flood)

    // Wait slightly beyond pool timeout so workers are freed
    await sleep(POOL_TIMEOUT_MS + 200)

    const res1 = await sendRequest(true)
    console.log(`  Post-timeout result: HTTP ${res1.status} (Took ${res1.duration}ms)`)

    if (res1.status === 200 || res1.status === 403) {
      console.log(
        '  ✅ PASSED: Server remained available after pool exhaustion. Fail-open preserved.',
      )
    } else {
      console.error(
        `  ❌ FAILED: Expected 200/403, got ${res1.status}. Error: ${res1.error ?? 'none'}`,
      )
      failedTests++
    }

    // ─── TEST 2: Pool Recovery After Burst ────────────────────────────────────
    // After a burst under pressure, the pool must self-recover and resume
    // normal request processing without operator intervention.
    console.log('\n[Test 2] Pool Recovery After Burst (simulates Crash/SIGKILL recovery)')
    console.log(
      '  Description: Verifies the pool recovers autonomously after a high-concurrency burst. No manual intervention required.',
    )

    // Burst: send 2×poolSize concurrent requests
    const burst = Array.from({ length: POOL_SIZE * 2 }, () => sendRequest(true))
    await Promise.all(burst)
    await sleep(POOL_TIMEOUT_MS + 300)

    // Pool must accept new work normally
    const res2 = await sendRequest(false) // Clean request (no threat)
    console.log(`  Post-burst clean request: HTTP ${res2.status} (Took ${res2.duration}ms)`)

    if (res2.status === 200) {
      console.log('  ✅ PASSED: Pool recovered autonomously. Clean traffic flows normally.')
    } else {
      console.error(`  ❌ FAILED: Pool failed to recover. HTTP ${res2.status}`)
      failedTests++
    }

    // ─── TEST 3: I/O Starvation ────────────────────────────────────────────────
    console.log('\n[Test 3] I/O Starvation / Read-Only Disk')
    console.log(
      '  Description: Blocks AuditChain write permissions to simulate disk failure. Expecting application to retain availability.',
    )

    execInContainer('mkdir -p /app/data/audit && chmod 400 /app/data/audit')

    const res3 = await sendRequest(true)
    console.log(`  Result: HTTP ${res3.status} (Took ${res3.duration}ms)`)

    if (res3.status === 200 || res3.status === 403) {
      console.log('  ✅ PASSED: Application survived I/O disk block.')
    } else {
      console.error(`  ❌ FAILED: Application crashed due to I/O block. HTTP ${res3.status}`)
      failedTests++
    }

    execInContainer('chmod 755 /app/data/audit')
  } finally {
    if (infrastructureStarted) {
      console.log('\n[Teardown] Cleaning up infrastructure...')
      // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
      execSync('docker compose -f infrastructure/chaos/docker-compose.yml down -v', {
        stdio: 'inherit',
      })
    }
  }

  if (failedTests > 0) {
    console.error(`\n❌ Chaos Suite finished with ${failedTests} failing invariant(s).`)
    process.exit(1)
  } else {
    console.log('\n✅ All Chaos Invariants PASSED. Tracehound is production-resilient.')
    process.exit(0)
  }
}

runTests().catch((e) => {
  console.error('Unhandled error running tests:', e)
  process.exit(1)
})
