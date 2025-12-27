/**
 * Fail-Safe Integration Scenario
 *
 * Tests fail-safe panic integration:
 * 1. Quarantine capacity triggers
 * 2. Error rate triggers
 * 3. Panic callback execution
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Agent,
  AuditChain,
  createAgent,
  createEvidenceFactory,
  createFailSafe,
  createRateLimiter,
  FailSafe,
  generateSecureId,
  Quarantine,
  type Scent,
} from '../src/index.js'

describe('Fail-Safe Integration Scenario', () => {
  let agent: Agent
  let quarantine: Quarantine
  let failSafe: FailSafe

  // Use unique payloads to avoid duplicates
  let payloadCounter = 0

  function createThreatScent(): Scent {
    payloadCounter++
    return {
      id: generateSecureId(),
      timestamp: Date.now(),
      source: 'attacker',
      payload: { attack: `unique-payload-${payloadCounter}`, time: Date.now() },
      threat: { category: 'injection', severity: 'high' },
    }
  }

  beforeEach(() => {
    payloadCounter = 0
    const auditChain = new AuditChain()
    quarantine = new Quarantine(
      { maxCount: 100, maxBytes: 10_000_000, evictionPolicy: 'priority' },
      auditChain
    )
    const rateLimiter = createRateLimiter({
      windowMs: 60_000,
      maxRequests: 10000, // High limit
      blockDurationMs: 1000,
    })
    const evidenceFactory = createEvidenceFactory()

    agent = createAgent(
      { maxPayloadSize: 1_000_000 },
      quarantine,
      rateLimiter,
      evidenceFactory
    ) as Agent

    failSafe = createFailSafe({
      quarantine: {
        warning: 0.5, // 50%
        critical: 0.7, // 70%
        emergency: 0.9, // 90%
      },
    })
  })

  it('should trigger warning at 50% quarantine capacity', () => {
    const handler = vi.fn()
    failSafe.on('warning', handler)

    // Fill to 50+ unique threats
    for (let i = 0; i < 55; i++) {
      agent.intercept(createThreatScent())
    }

    // Check quarantine capacity
    const count = quarantine.stats.count
    failSafe.checkQuarantine(count, 100)

    expect(count).toBeGreaterThanOrEqual(50)
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warning',
        reason: 'quarantine_capacity',
      })
    )
  })

  it('should trigger critical at 70% capacity', () => {
    const handler = vi.fn()
    failSafe.on('critical', handler)

    // Fill to 75+ unique threats
    for (let i = 0; i < 75; i++) {
      agent.intercept(createThreatScent())
    }

    const count = quarantine.stats.count
    failSafe.checkQuarantine(count, 100)

    expect(count).toBeGreaterThanOrEqual(70)
    expect(handler).toHaveBeenCalled()
  })

  it('should trigger emergency at 90% capacity', () => {
    const handler = vi.fn()
    failSafe.on('emergency', handler)

    // Fill to 95+ unique threats
    for (let i = 0; i < 95; i++) {
      agent.intercept(createThreatScent())
    }

    const count = quarantine.stats.count
    failSafe.checkQuarantine(count, 100)

    expect(count).toBeGreaterThanOrEqual(90)
    expect(handler).toHaveBeenCalled()
  })

  it('should execute emergency flush on panic', () => {
    const flushed = vi.fn()

    failSafe.on('emergency', () => {
      // Emergency action: flush quarantine
      const records = quarantine.flush()
      flushed(records.length)
    })

    // Fill quarantine to 95+
    for (let i = 0; i < 95; i++) {
      agent.intercept(createThreatScent())
    }

    const countBefore = quarantine.stats.count
    failSafe.checkQuarantine(countBefore, 100)

    expect(flushed).toHaveBeenCalled()
    expect(quarantine.stats.count).toBe(0)
  })

  it('should track panic history', () => {
    failSafe.panic('warning', 'Test warning')
    failSafe.panic('critical', 'Test critical')

    expect(failSafe.history.length).toBe(2)
    expect(failSafe.lastPanic?.level).toBe('critical')
    expect(failSafe.lastPanic?.context.details).toBe('Test critical')
  })

  it('should integrate with error rate monitoring', () => {
    const handler = vi.fn()

    const errorTrackingFailSafe = createFailSafe({
      errorRate: {
        warning: 5,
        critical: 10,
        emergency: 20,
      },
    })

    errorTrackingFailSafe.on('critical', handler)

    // Simulate high error rate
    errorTrackingFailSafe.checkErrorRate(15) // > 10 = critical

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'critical',
        reason: 'error_rate',
      })
    )
  })
})
