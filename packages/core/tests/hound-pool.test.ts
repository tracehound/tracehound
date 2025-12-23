/**
 * Hound Pool tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Evidence } from '../src/core/evidence.js'
import {
  createHoundPool,
  HoundPool,
  type HoundResult,
  type IHoundPool,
} from '../src/core/hound-pool.js'
import { encodePayload } from '../src/utils/encode.js'
import { hashBuffer } from '../src/utils/hash.js'

describe('HoundPool', () => {
  let pool: IHoundPool

  beforeEach(() => {
    vi.useFakeTimers()
    pool = createHoundPool({
      poolSize: 3,
      timeout: 1000,
      rotationJitterMs: 10,
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
      Date.now()
    )
  }

  describe('Construction', () => {
    it('pre-spawns configured number of workers', () => {
      const stats = pool.stats

      expect(stats.totalWorkers).toBe(3)
      expect(stats.activeWorkers).toBe(0)
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

    it('marks worker as busy', () => {
      const evidence = createEvidence('test')

      pool.activate(evidence)

      expect(pool.stats.activeWorkers).toBe(1)
    })

    it('queues when all workers busy', () => {
      // Activate 3 (pool size) + 2 more
      for (let i = 0; i < 5; i++) {
        pool.activate(createEvidence(`test-${i}`))
      }

      expect(pool.stats.activeWorkers).toBe(3)
      expect(pool.stats.totalActivations).toBe(5)
    })
  })

  describe('Result handling', () => {
    it('calls onResult handler when processing completes', async () => {
      const results: HoundResult[] = []
      pool.onResult((result) => results.push(result))

      const evidence = createEvidence('test')
      pool.activate(evidence)

      // Fast-forward past processing delay
      await vi.advanceTimersByTimeAsync(100)

      expect(results.length).toBe(1)
      expect(results[0].status).toBe('processed')
      expect(results[0].signature).toBe(evidence.signature)
    })

    it('result includes workerId and durationMs', async () => {
      const results: HoundResult[] = []
      pool.onResult((result) => results.push(result))

      pool.activate(createEvidence('test'))
      await vi.advanceTimersByTimeAsync(100)

      expect(results[0].workerId).toMatch(/^hound-\d+$/)
      expect(results[0].durationMs).toBeGreaterThan(0)
    })

    it('worker becomes available after completion', async () => {
      pool.activate(createEvidence('test'))
      expect(pool.stats.activeWorkers).toBe(1)

      await vi.advanceTimersByTimeAsync(100)

      expect(pool.stats.activeWorkers).toBe(0)
    })
  })

  describe('Timeout handling', () => {
    it('terminates worker on timeout', async () => {
      const results: HoundResult[] = []

      // Create pool with very short timeout (5ms)
      // Processing delay is 10 + jitter, so timeout will always fire first
      pool.shutdown()
      pool = createHoundPool({
        poolSize: 1,
        timeout: 5, // Very short - will timeout before 10ms minimum delay
        rotationJitterMs: 50,
      })
      pool.onResult((result) => results.push(result))

      pool.activate(createEvidence('will-timeout'))

      // Fast-forward past timeout but before processing could complete
      await vi.advanceTimersByTimeAsync(6)

      expect(results.length).toBe(1)
      expect(results[0].status).toBe('timeout')
      expect(pool.stats.totalTimeouts).toBe(1)
    })
  })

  describe('terminate()', () => {
    it('terminates specific evidence by signature', async () => {
      const results: HoundResult[] = []
      pool.onResult((result) => results.push(result))

      const evidence = createEvidence('terminate-me')
      pool.activate(evidence)

      expect(pool.stats.activeWorkers).toBe(1)

      pool.terminate(evidence.signature)

      expect(pool.stats.activeWorkers).toBe(0)
      expect(results.length).toBe(1)
      expect(results[0].status).toBe('error')
      expect(results[0].error).toBe('forced_terminate')
    })

    it('ignores invalid signature', () => {
      pool.activate(createEvidence('test'))

      pool.terminate('invalid:signature')

      expect(pool.stats.activeWorkers).toBe(1) // Still active
    })
  })

  describe('Queue processing', () => {
    it('processes queued items when worker becomes available', async () => {
      const results: HoundResult[] = []
      pool.onResult((result) => results.push(result))

      // Fill pool + queue
      for (let i = 0; i < 5; i++) {
        pool.activate(createEvidence(`test-${i}`))
      }

      // Process all
      await vi.advanceTimersByTimeAsync(500)

      expect(results.length).toBe(5)
      expect(results.every((r) => r.status === 'processed')).toBe(true)
    })
  })

  describe('Sandbox constraints', () => {
    it('has strict sandbox constraints (read-only)', () => {
      const constraints = HoundPool.SANDBOX_CONSTRAINTS

      expect(constraints.eval).toBe(false)
      expect(constraints.network).toBe(false)
      expect(constraints.storage).toBe(false)
      expect(constraints.importScripts).toBe(false)

      // Should be frozen
      expect(Object.isFrozen(constraints)).toBe(true)
    })
  })

  describe('shutdown()', () => {
    it('clears all workers', () => {
      pool.activate(createEvidence('test'))
      expect(pool.stats.activeWorkers).toBe(1)

      pool.shutdown()

      expect(pool.stats.totalWorkers).toBe(0)
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
