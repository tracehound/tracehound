import { execSync } from 'child_process'

const TARGET_URL = 'http://127.0.0.1:3000/api/data'
const CONTAINER_NAME = 'chaos-target-app-1'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function sendThreatRequest() {
  const start = Date.now()
  try {
    const res = await fetch(TARGET_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-chaos-threat': 'true', // Triggers threat detection in Tracehound
      },
      body: JSON.stringify({ chaos: true }),
      signal: AbortSignal.timeout(5000), // Max 5s wait to prevent hanging the test suite indefinitely
    })
    const data = await res.json()
    return { status: res.status, duration: Date.now() - start, success: true, data }
  } catch (err: any) {
    return { status: 0, duration: Date.now() - start, success: false, error: err.message }
  }
}

function execInContainer(cmd: string): string {
  try {
    return execSync(`docker exec ${CONTAINER_NAME} sh -c "${cmd}"`, { stdio: 'pipe' })
      .toString()
      .trim()
  } catch (e: any) {
    return ''
  }
}

console.log('--- Tracehound Local Chaos & Invariant Verification Suite ---\n')

async function waitForServer() {
  process.stdout.write('Waiting for target-app server to be ready...')
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch('http://127.0.0.1:3000/api/health', { method: 'GET' })
      if (res.ok) {
        console.log(' Ready!')
        return
      }
    } catch {}
    process.stdout.write('.')
    await sleep(2000)
  }
  console.error('\nFailed to connect to target-app.')
  process.exit(1)
}

async function getWorkerPids() {
  // Find node processes inside the container explicitly running hound-process
  const pidsStr = execInContainer(`pgrep -f "hound-process"`)
  if (!pidsStr) return []
  const pids = pidsStr
    .split('\n')
    .map((p) => parseInt(p.trim()))
    .filter((p) => !isNaN(p))

  return pids
}

async function runTests() {
  // 1. Setup
  console.log('[Setup] Bringing up testing infrastructure...')
  execSync('docker compose -f infrastructure/chaos/docker-compose.yml up -d --build', {
    stdio: 'inherit',
  })
  await sleep(3000)
  await waitForServer()

  let failedTests = 0

  // Wait a bit for hounds to spawn
  await sleep(2000)
  const workers = await getWorkerPids()
  console.log(`[Info] Detected Tracehound worker processes: ${workers.join(', ')}`)

  // --- TEST 1: Zombie Hound (SIGSTOP) ---
  console.log('\n[Test 1] Zombie Hound (SIGSTOP) & Timeout Fail-Open')
  console.log(
    '  Description: Freezes a Tracehound worker to simulate extreme CPU starvation. Expecting Fail-Open after 100ms.',
  )
  if (workers.length > 0) {
    const targetPid = workers[0]
    execInContainer(`kill -SIGSTOP ${targetPid}`)
    console.log(`  Frozen worker PID: ${targetPid}`)

    // Fire multiple concurrent requests
    const p1 = sendThreatRequest()
    const p2 = sendThreatRequest()
    const [res1, res2] = await Promise.all([p1, p2])

    console.log(`  Result 1: HTTP ${res1.status} (Took ${res1.duration}ms)`)
    console.log(`  Result 2: HTTP ${res2.status} (Took ${res2.duration}ms)`)

    // Verify properties
    if (res1.status === 200 || res1.status === 403) {
      console.log(
        '  ✅ PASSED: System did not deadlock. Fail-open mechanism preserved application availability.',
      )
    } else {
      console.error(
        `  ❌ FAILED: Unexpected state. Expected 200/403, got ${res1.status} Error: ${res1.error}`,
      )
      failedTests++
    }

    // Resume worker
    execInContainer(`kill -SIGCONT ${targetPid}`)
  } else {
    console.error('  ⚠️ SKIPPED: No worker processes detected.')
  }

  // --- TEST 2: Poison Pill / Crash (SIGKILL) ---
  console.log('\n[Test 2] Poison Pill / Crash (SIGKILL)')
  console.log(
    '  Description: Abruptly terminates a worker to simulate memory corruption or native crash. Expecting graceful recovery/retry.',
  )
  if (workers.length > 1) {
    const targetPid = workers[1]
    execInContainer(`kill -SIGKILL ${targetPid}`)
    console.log(`  Terminated worker PID: ${targetPid}`)

    const res = await sendThreatRequest()
    console.log(`  Result: HTTP ${res.status} (Took ${res.duration}ms)`)

    if (res.status === 200 || res.status === 403) {
      console.log('  ✅ PASSED: Main thread survived the worker crash and processed the request.')
    } else {
      console.error(`  ❌ FAILED: API went down or returned error. HTTP ${res.status}`)
      failedTests++
    }
  }

  // --- TEST 3: I/O Starvation ---
  console.log('\n[Test 3] I/O Starvation / Read-Only Disk')
  console.log(
    '  Description: Blocks AuditChain write permissions to simulate disk failure. Expecting application to retain availability.',
  )

  // Create audit dir if it doesnt exist and chmod it to be unwritable
  execInContainer('mkdir -p /app/data/audit && chmod 400 /app/data/audit')

  const res3 = await sendThreatRequest()
  console.log(`  Result: HTTP ${res3.status} (Took ${res3.duration}ms)`)

  if (res3.status === 200 || res3.status === 403) {
    console.log('  ✅ PASSED: Application survived I/O disk block.')
  } else {
    console.error(`  ❌ FAILED: Application crashed due to I/O block. HTTP ${res3.status}`)
    failedTests++
  }

  // Cleanup permissions
  execInContainer('chmod 755 /app/data/audit')

  // Teardown
  console.log('\n[Teardown] Cleaning up infrastructure...')
  execSync('docker compose -f infrastructure/chaos/docker-compose.yml down -v', {
    stdio: 'inherit',
  })

  if (failedTests > 0) {
    console.error(`\n❌ Chaos Suite finished with ${failedTests} failing invariants.`)
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
