/**
 * Integration Tests - Full Flow Verification
 *
 * These tests verify the complete flow from scent to quarantine,
 * including edge cases and failure modes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Agent } from '../src/core/agent.js'
import { AuditChain } from '../src/core/audit-chain.js'
import { createEvidenceFactory } from '../src/core/evidence-factory.js'
import { Evidence } from '../src/core/evidence.js'
import { createHoundPool, type HoundResult, type IHoundPool } from '../src/core/hound-pool.js'
import { Quarantine } from '../src/core/quarantine.js'
import { createRateLimiter, type IRateLimiter } from '../src/core/rate-limiter.js'
import { createScheduler, type IScheduler } from '../src/core/scheduler.js'
import { createWatcher, type IWatcher } from '../src/core/watcher.js'
import type { JsonSerializable } from '../src/types/common.js'
import type { Scent } from '../src/types/scent.js'

describe('Integration: Full System Flow', () => {
  let agent: Agent
  let quarantine: Quarantine
  let auditChain: AuditChain
  let rateLimiter: IRateLimiter
  let houndPool: IHoundPool
  let scheduler: IScheduler
  let watcher: IWatcher

  beforeEach(() => {
    vi.useFakeTimers()

    auditChain = new AuditChain()
    quarantine = new Quarantine(
      { maxCount: 100, maxBytes: 1_000_000, evictionPolicy: 'priority' },
      auditChain
    )
    rateLimiter = createRateLimiter({
      windowMs: 60_000,
      maxRequests: 10,
      blockDurationMs: 300_000,
    })
    const evidenceFactory = createEvidenceFactory()

    agent = new Agent({ maxPayloadSize: 100_000 }, quarantine, rateLimiter, evidenceFactory)

    houndPool = createHoundPool({
      poolSize: 3,
      timeout: 5000,
      rotationJitterMs: 100,
    })

    scheduler = createScheduler({
      tickInterval: 1000,
      jitterMs: 100,
    })

    watcher = createWatcher({
      maxAlertsPerWindow: 10,
      alertWindowMs: 60_000,
      quarantineHighWatermark: 0.8,
    })
  })

  afterEach(() => {
    houndPool.shutdown()
    scheduler.stop()
    vi.useRealTimers()
  })

  function createScent(id: string, payload: JsonSerializable, threat?: boolean): Scent {
    return {
      id,
      payload,
      source: `source-${id}`,
      timestamp: Date.now(),
      threat: threat ? { category: 'injection', severity: 'high' } : undefined,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Full Flow Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Scent → Agent → Quarantine → AuditChain', () => {
    it('clean scent passes through without quarantine', () => {
      const scent = createScent('clean-1', { data: 'safe' }, false)

      const result = agent.intercept(scent)

      expect(result.status).toBe('clean')
      expect(quarantine.stats.count).toBe(0)
    })

    it('threat scent is quarantined', () => {
      const scent = createScent('threat-1', { attack: 'sql injection' }, true)

      const result = agent.intercept(scent)

      expect(result.status).toBe('quarantined')
      expect(quarantine.stats.count).toBe(1)
    })

    it('neutralize creates audit record', () => {
      const scent = createScent('audit-1', { malware: true }, true)
      const result = agent.intercept(scent)

      expect(result.status).toBe('quarantined')
      if (result.status === 'quarantined') {
        quarantine.neutralize(result.handle.signature)

        expect(auditChain.length).toBe(1)
        expect(auditChain.verify()).toBe(true)
      }
    })

    it('duplicate signature is ignored', () => {
      const payload = { attack: 'same attack' }
      const scent1 = createScent('dup-1', payload, true)
      const scent2 = createScent('dup-2', payload, true)

      agent.intercept(scent1)
      const result2 = agent.intercept(scent2)

      expect(result2.status).toBe('ignored')
      expect(quarantine.stats.count).toBe(1)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Rate Limiting Flow
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Rate Limiting Integration', () => {
    it('rate limits excessive requests from same source', () => {
      const source = 'attacker-ip'
      let rateLimitedCount = 0

      for (let i = 0; i < 15; i++) {
        const scent: Scent = {
          id: `attack-${i}`,
          payload: { data: i },
          source,
          timestamp: Date.now(),
        }

        const result = agent.intercept(scent)
        if (result.status === 'rate_limited') {
          rateLimitedCount++
        }
      }

      expect(rateLimitedCount).toBe(5) // 15 - 10 (limit)
    })

    it('rate limit resets after window', () => {
      const source = 'temp-attacker'

      // Fill rate limit
      for (let i = 0; i < 10; i++) {
        agent.intercept({
          id: `fill-${i}`,
          payload: { i },
          source,
          timestamp: Date.now(),
        })
      }

      // Advance past window
      vi.advanceTimersByTime(60_001)

      // Should be allowed again
      const result = agent.intercept({
        id: 'after-window',
        payload: { test: true },
        source,
        timestamp: Date.now(),
      })

      expect(result.status).not.toBe('rate_limited')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Quarantine Eviction
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Quarantine Eviction Under Pressure', () => {
    it('evicts when maxCount exceeded', () => {
      // Create small quarantine
      const smallQuarantine = new Quarantine(
        { maxCount: 5, maxBytes: 10_000_000, evictionPolicy: 'priority' },
        new AuditChain()
      )
      const smallAgent = new Agent(
        { maxPayloadSize: 100_000 },
        smallQuarantine,
        createRateLimiter({ windowMs: 60_000, maxRequests: 100, blockDurationMs: 300_000 }),
        createEvidenceFactory()
      )

      // Insert 7 items (exceeds maxCount of 5)
      for (let i = 0; i < 7; i++) {
        smallAgent.intercept({
          id: `evict-${i}`,
          payload: { unique: i },
          source: 'test',
          timestamp: Date.now(),
          threat: { category: 'spam', severity: 'low' },
        })
      }

      expect(smallQuarantine.stats.count).toBe(5) // Evicted 2
    })

    it('eviction during active intercept does not corrupt state', () => {
      const tinyQuarantine = new Quarantine(
        { maxCount: 2, maxBytes: 10_000_000, evictionPolicy: 'priority' },
        new AuditChain()
      )
      const tinyAgent = new Agent(
        { maxPayloadSize: 100_000 },
        tinyQuarantine,
        createRateLimiter({ windowMs: 60_000, maxRequests: 100, blockDurationMs: 300_000 }),
        createEvidenceFactory()
      )

      // Rapid inserts
      const signatures: string[] = []
      for (let i = 0; i < 10; i++) {
        const result = tinyAgent.intercept({
          id: `rapid-${i}`,
          payload: { data: `value-${i}` },
          source: 'test',
          timestamp: Date.now(),
          threat: { category: 'injection', severity: 'high' },
        })

        if (result.status === 'quarantined') {
          signatures.push(result.handle.signature)
        }
      }

      // State should be consistent
      expect(tinyQuarantine.stats.count).toBe(2)
      expect(tinyQuarantine.stats.count).toBeLessThanOrEqual(2)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Hound Pool Integration
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Hound Pool Integration', () => {
    it('Agent does NOT await Hound Pool', () => {
      const scent = createScent('hound-test', { data: 'test' }, true)
      const result = agent.intercept(scent)

      // Intercept completes immediately
      expect(result.status).toBe('quarantined')

      // Hound activation is separate (fire-and-forget)
      if (result.status === 'quarantined') {
        // Cast handle to Evidence for HoundPool (in real code, Agent returns Evidence directly)
        const houndResult = houndPool.activate(result.handle as unknown as Evidence)
        expect(houndResult).toBeUndefined() // Returns void, not Promise
      }
    })

    it('Hound timeout triggers replenish', async () => {
      const results: HoundResult[] = []
      houndPool.onResult((r) => results.push(r))

      // Create short timeout pool
      const shortPool = createHoundPool({
        poolSize: 1,
        timeout: 5,
        rotationJitterMs: 100,
      })
      shortPool.onResult((r) => results.push(r))

      const scent = createScent('timeout-test', { data: 'test' }, true)
      const agentResult = agent.intercept(scent)

      if (agentResult.status === 'quarantined') {
        shortPool.activate(agentResult.handle as unknown as Evidence)
      }

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(10)

      expect(results.some((r) => r.status === 'timeout')).toBe(true)
      expect(shortPool.stats.totalTimeouts).toBe(1)
      // Pool should still be usable
      expect(shortPool.stats.totalProcesses).toBe(1)

      shortPool.shutdown()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Scheduler Integration
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Scheduler Integration', () => {
    it('scheduled cleanup runs periodically', () => {
      let cleanupCount = 0

      scheduler.schedule({
        id: 'rate-limiter-cleanup',
        execute: () => {
          rateLimiter.cleanup()
          cleanupCount++
        },
        intervalMs: 1000,
      })

      scheduler.start()
      vi.advanceTimersByTime(5000)

      expect(cleanupCount).toBeGreaterThan(0)
    })

    it('skipIfBusy prevents tick during load', () => {
      let tickCount = 0

      // Create scheduler with short tick interval
      const busyScheduler = createScheduler({
        tickInterval: 50,
        jitterMs: 10,
        skipIfBusy: true,
      })

      busyScheduler.setBusyChecker(() => true) // Always busy
      busyScheduler.schedule({
        id: 'test-task',
        execute: () => {
          tickCount++
        },
        intervalMs: 10,
      })

      busyScheduler.start()
      vi.advanceTimersByTime(500) // Allow multiple tick attempts

      expect(tickCount).toBe(0) // All skipped
      expect(busyScheduler.stats.skippedTicks).toBeGreaterThan(0)

      busyScheduler.stop()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Watcher Integration
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Watcher Integration', () => {
    it('tracks threats via Agent integration', () => {
      // Simulate Agent → Watcher integration
      for (let i = 0; i < 5; i++) {
        const scent = createScent(`monitored-${i}`, { attack: i }, true)
        const result = agent.intercept(scent)

        if (result.status === 'quarantined') {
          watcher.recordThreat('injection', 'high')
        }
      }

      const snapshot = watcher.snapshot()

      expect(snapshot.threats.total).toBe(5)
      expect(snapshot.threats.byCategory.injection).toBe(5)
    })

    it('alerts on quarantine high watermark', () => {
      // Simulate quarantine filling up
      watcher.updateQuarantine(80, 800_000, 1_000_000) // 80%

      const snapshot = watcher.snapshot()

      expect(snapshot.lastAlert).not.toBeNull()
      expect(snapshot.lastAlert?.type).toBe('quarantine_high')
    })

    it('rate limits alerts', () => {
      // Max 10 alerts per window
      for (let i = 0; i < 15; i++) {
        watcher.alert({
          type: 'threat_detected',
          severity: 'info',
          message: `Alert ${i}`,
        })
      }

      expect(watcher.snapshot().totalAlerts).toBe(10) // Rate limited
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Concurrent Access
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Concurrent Access', () => {
    it('handles multiple sources concurrently', () => {
      const sources = ['ip-1', 'ip-2', 'ip-3', 'ip-4', 'ip-5']
      const results: Map<string, number> = new Map()

      for (const source of sources) {
        let count = 0
        for (let i = 0; i < 5; i++) {
          const result = agent.intercept({
            id: `${source}-${i}`,
            payload: { source, i },
            source,
            timestamp: Date.now(),
            threat: { category: 'ddos', severity: 'medium' },
          })
          if (result.status === 'quarantined') count++
        }
        results.set(source, count)
      }

      // Each source should have some quarantined (first unique payloads)
      // and some ignored (duplicates)
      const totalQuarantined = Array.from(results.values()).reduce((a, b) => a + b, 0)
      expect(totalQuarantined).toBeGreaterThan(0)
      expect(quarantine.stats.count).toBe(totalQuarantined)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Memory Pressure
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Memory Pressure', () => {
    it('system remains stable under memory pressure', () => {
      // Small quarantine with byte limit
      const limitedQuarantine = new Quarantine(
        { maxCount: 1000, maxBytes: 10_000, evictionPolicy: 'priority' },
        new AuditChain()
      )
      const limitedAgent = new Agent(
        { maxPayloadSize: 100_000 },
        limitedQuarantine,
        createRateLimiter({ windowMs: 60_000, maxRequests: 1000, blockDurationMs: 300_000 }),
        createEvidenceFactory()
      )

      // Insert many items with large payloads
      for (let i = 0; i < 100; i++) {
        limitedAgent.intercept({
          id: `big-${i}`,
          payload: { data: 'x'.repeat(500), unique: i },
          source: 'test',
          timestamp: Date.now(),
          threat: { category: 'malware', severity: 'low' },
        })
      }

      // Should have evicted to stay under limit
      expect(limitedQuarantine.stats.bytes).toBeLessThanOrEqual(10_000)
    })
  })
})
