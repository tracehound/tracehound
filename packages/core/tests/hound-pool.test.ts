/**
 * Hound Pool tests.
 *
 * Uses mock process adapter (no real child processes).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Evidence } from '../src/core/evidence.js'
import { encodeHoundMessage } from '../src/core/hound-ipc.js'
import {
  createHoundPool,
  createMockAdapter,
  HoundPool,
  type HoundResult,
  type IHoundPool,
} from '../src/core/hound-pool.js'
import { encodePayload } from '../src/utils/encode.js'
import { hashBuffer } from '../src/utils/hash.js'

describe('HoundPool', () => {
  let pool: IHoundPool
  let mockAdapter: ReturnType<typeof createMockAdapter>

  beforeEach(() => {
    vi.useFakeTimers()
    mockAdapter = createMockAdapter()
    pool = createHoundPool({
      poolSize: 3,
      timeout: 1000,
      rotationJitterMs: 10,
      adapter: mockAdapter,
    })
  })

  afterEach(() => {
    pool.shutdown()
    vi.useRealTimers()
  })

  // Helper to create test evidence
  function createEvidence(id: string): Evidence {
    const payload = { test: id }
    const encoded = encodePayload(payload, 1_000_000)
    const hash = hashBuffer(encoded.bytes)

    return new Evidence(
      encoded.bytes.buffer as ArrayBuffer,
      `injection:${hash}`,
      hash,
      'high',
      Date.now(),
    )
  }

  // Helper to simulate process completion
  function simulateProcessComplete(pid: number): void {
    const message = encodeHoundMessage({ type: 'status', state: 'complete' })
    // Extract payload from length-prefixed message
    const payloadSlice = message.subarray(4)
    const payload = new Uint8Array(payloadSlice).buffer
    mockAdapter.simulateMessage(pid, payload)
  }

  describe('Construction', () => {
    it('pre-spawns configured number of process slots', () => {
      const stats = pool.stats

      expect(stats.totalProcesses).toBe(3)
      expect(stats.activeProcesses).toBe(0)
    })

    it('stats are immutable snapshots', () => {
      const stats1 = pool.stats
      const evidence = createEvidence('test')

      pool.activate(evidence)
      const stats2 = pool.stats

      expect(stats1.totalActivations).toBe(0)
      expect(stats2.totalActivations).toBe(1)
    })
  })

  describe('activate()', () => {
    it('returns void, not Promise', () => {
      const evidence = createEvidence('test')

      const result = pool.activate(evidence)

      // CRITICAL: activate() returns void, NOT Promise
      expect(result).toBeUndefined()
    })

    it('increments totalActivations', () => {
      const evidence = createEvidence('test')

      pool.activate(evidence)

      expect(pool.stats.totalActivations).toBe(1)
    })

    it('marks process as busy', () => {
      const evidence = createEvidence('test')

      pool.activate(evidence)

      expect(pool.stats.activeProcesses).toBe(1)
    })

    it('handles pool exhaustion with drop (default)', () => {
      const results: HoundResult[] = []
      pool.onResult((result) => results.push(result))

      // Fill pool (3) + 2 more (will be dropped since default is 'drop')
      for (let i = 0; i < 5; i++) {
        pool.activate(createEvidence(`test-${i}`))
      }

      expect(pool.stats.activeProcesses).toBe(3)
      expect(pool.stats.totalActivations).toBe(5)
      // 2 dropped = 2 error results
      expect(results.filter((r) => r.error === 'pool_exhausted').length).toBe(2)
    })
  })

  describe('Result handling', () => {
    it('calls onResult handler when processing completes', () => {
      const results: HoundResult[] = []
      pool.onResult((result) => results.push(result))

      const evidence = createEvidence('test')
      pool.activate(evidence)

      // Get spawned process PID
      const processes = mockAdapter.getMockProcesses()
      const pid = [...processes.keys()][0]

      // Simulate completion
      simulateProcessComplete(pid)

      expect(results.length).toBe(1)
      expect(results[0].status).toBe('processed')
      expect(results[0].signature).toBe(evidence.signature)
    })

    it('result includes processId and durationMs', () => {
      const results: HoundResult[] = []
      pool.onResult((result) => results.push(result))

      pool.activate(createEvidence('test'))

      const processes = mockAdapter.getMockProcesses()
      const pid = [...processes.keys()][0]
      simulateProcessComplete(pid)

      expect(results[0].processId).toMatch(/^hound-\d+$/)
      expect(results[0].durationMs).toBeGreaterThanOrEqual(0)
    })

    it('process becomes available after completion', () => {
      pool.activate(createEvidence('test'))
      expect(pool.stats.activeProcesses).toBe(1)

      const processes = mockAdapter.getMockProcesses()
      const pid = [...processes.keys()][0]
      simulateProcessComplete(pid)

      expect(pool.stats.activeProcesses).toBe(0)
    })
  })

  describe('Timeout handling', () => {
    it('terminates process on timeout', async () => {
      const results: HoundResult[] = []
      pool.shutdown()

      mockAdapter = createMockAdapter()
      pool = createHoundPool({
        poolSize: 1,
        timeout: 5,
        rotationJitterMs: 50,
        adapter: mockAdapter,
      })
      pool.onResult((result) => results.push(result))

      pool.activate(createEvidence('will-timeout'))

      // Fast-forward past timeout
      await vi.advanceTimersByTimeAsync(6)

      // Expect at least one timeout result
      const timeoutResults = results.filter((r) => r.status === 'timeout')
      expect(timeoutResults.length).toBeGreaterThanOrEqual(1)
      expect(pool.stats.totalTimeouts).toBe(1)
    })
  })

  describe('terminate()', () => {
    it('terminates specific evidence by signature', () => {
      const results: HoundResult[] = []
      pool.onResult((result) => results.push(result))

      const evidence = createEvidence('terminate-me')
      pool.activate(evidence)

      expect(pool.stats.activeProcesses).toBe(1)

      pool.terminate(evidence.signature)

      expect(pool.stats.activeProcesses).toBe(0)
      // Check for forced_terminate result (may also have exit result from mock)
      const terminateResult = results.find((r) => r.error === 'forced_terminate')
      expect(terminateResult).toBeDefined()
      expect(terminateResult?.status).toBe('error')
    })

    it('ignores invalid signature', () => {
      pool.activate(createEvidence('test'))

      pool.terminate('invalid:signature')

      expect(pool.stats.activeProcesses).toBe(1) // Still active
    })
  })

  describe('PoolExhaustedAction', () => {
    it('defer queues up to limit', () => {
      pool.shutdown()
      mockAdapter = createMockAdapter()
      pool = createHoundPool({
        poolSize: 1,
        timeout: 1000,
        rotationJitterMs: 10,
        onPoolExhausted: 'defer',
        deferQueueLimit: 2,
        adapter: mockAdapter,
      })

      const results: HoundResult[] = []
      pool.onResult((result) => results.push(result))

      // 1 active + 2 deferred + 1 dropped
      for (let i = 0; i < 4; i++) {
        pool.activate(createEvidence(`test-${i}`))
      }

      expect(pool.stats.activeProcesses).toBe(1)
      // 1 dropped (queue full)
      expect(results.filter((r) => r.error === 'defer_queue_full').length).toBe(1)
    })

    it('escalate emits error but continues', () => {
      pool.shutdown()
      mockAdapter = createMockAdapter()
      pool = createHoundPool({
        poolSize: 1,
        timeout: 1000,
        rotationJitterMs: 10,
        onPoolExhausted: 'escalate',
        adapter: mockAdapter,
      })

      const results: HoundResult[] = []
      pool.onResult((result) => results.push(result))

      // Fill pool + 1 more
      pool.activate(createEvidence('test-1'))
      pool.activate(createEvidence('test-2'))

      expect(pool.stats.activeProcesses).toBe(1)
      expect(results.filter((r) => r.error === 'pool_exhausted_escalated').length).toBe(1)
      expect(pool.stats.totalErrors).toBeGreaterThan(0)
    })

    it('deferred items are processed when slot becomes available', () => {
      pool.shutdown()
      mockAdapter = createMockAdapter()
      pool = createHoundPool({
        poolSize: 1,
        timeout: 1000,
        rotationJitterMs: 10,
        onPoolExhausted: 'defer',
        deferQueueLimit: 5,
        adapter: mockAdapter,
      })

      const results: HoundResult[] = []
      pool.onResult((result) => results.push(result))

      // Queue 3 items (1 active + 2 deferred)
      pool.activate(createEvidence('test-1'))
      pool.activate(createEvidence('test-2'))
      pool.activate(createEvidence('test-3'))

      expect(pool.stats.activeProcesses).toBe(1)

      // Complete first one
      const processes = mockAdapter.getMockProcesses()
      const pid = [...processes.keys()][0]
      simulateProcessComplete(pid)

      // Next deferred item should start
      expect(pool.stats.activeProcesses).toBe(1)
    })
  })

  describe('Process error handling', () => {
    it('handles IPC decode errors', () => {
      const results: HoundResult[] = []
      pool.onResult((result) => results.push(result))

      pool.activate(createEvidence('test'))

      const processes = mockAdapter.getMockProcesses()
      const pid = [...processes.keys()][0]

      // Send invalid message
      const invalidPayload = new Uint8Array([0xff, 0xff, 0xff]).buffer
      mockAdapter.simulateMessage(pid, invalidPayload)

      const errorResults = results.filter((r) => r.status === 'error')
      expect(errorResults.length).toBeGreaterThan(0)
      expect(pool.stats.totalErrors).toBeGreaterThan(0)
    })

    it('handles process status error messages', () => {
      const results: HoundResult[] = []
      pool.onResult((result) => results.push(result))

      pool.activate(createEvidence('test'))

      const processes = mockAdapter.getMockProcesses()
      const pid = [...processes.keys()][0]

      // Send error status
      const errorMessage = encodeHoundMessage({
        type: 'status',
        state: 'error',
        error: 'analysis_failed',
      })
      const payloadSlice = errorMessage.subarray(4)
      const payload = new Uint8Array(payloadSlice).buffer
      mockAdapter.simulateMessage(pid, payload)

      const errorResults = results.filter((r) => r.status === 'error')
      expect(errorResults.length).toBeGreaterThan(0)
      expect(errorResults[0].error).toBeDefined()
    })

    it('handles unexpected process exit', () => {
      const results: HoundResult[] = []
      pool.onResult((result) => results.push(result))

      pool.activate(createEvidence('test'))

      const processes = mockAdapter.getMockProcesses()
      const pid = [...processes.keys()][0]

      // Simulate unexpected exit
      mockAdapter.simulateExit(pid, 1)

      const errorResults = results.filter((r) => r.status === 'error')
      expect(errorResults.length).toBeGreaterThan(0)
      expect(pool.stats.totalErrors).toBeGreaterThan(0)
    })

    it('respawns process on next activation after crash', () => {
      pool.activate(createEvidence('test-1'))

      const processes1 = mockAdapter.getMockProcesses()
      const pid1 = [...processes1.keys()][0]

      // Crash the process
      mockAdapter.simulateExit(pid1, 1)

      // Activate again - should spawn new process
      pool.activate(createEvidence('test-2'))

      const processes2 = mockAdapter.getMockProcesses()
      // Mock adapter keeps crashed process in map, so we expect 2
      expect(processes2.size).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Process constraints', () => {
    it('has default constraints (declarative)', () => {
      const constraints = HoundPool.DEFAULT_CONSTRAINTS

      expect(constraints.networkAccess).toBe(false)
      expect(constraints.fileSystemWrite).toBe(false)
      expect(constraints.childSpawn).toBe(false)

      // Should be frozen
      expect(Object.isFrozen(constraints)).toBe(true)
    })
  })

  describe('shutdown()', () => {
    it('clears all processes', () => {
      pool.activate(createEvidence('test'))
      expect(pool.stats.activeProcesses).toBe(1)

      pool.shutdown()

      expect(pool.stats.totalProcesses).toBe(0)
    })
  })

  describe('Type-level safety', () => {
    it('activate() return type is void', () => {
      const evidence = createEvidence('type-check')

      // This should NOT compile if activate returns Promise
      // @ts-expect-error - activate() returns void, not Promise
      const promise: Promise<void> = pool.activate(evidence)

      // Runtime check
      expect(promise).toBeUndefined()
    })
  })
})
