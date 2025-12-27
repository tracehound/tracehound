/**
 * Full Lifecycle Scenario Test
 *
 * Tests the complete flow:
 * 1. Clean request → clean result
 * 2. Threat request → quarantine
 * 3. Duplicate → ignored
 * 4. Rate limit → rate_limited
 * 5. Neutralize → audit chain
 * 6. Purge → purge record
 * 7. Replace → atomic swap
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  Agent,
  AuditChain,
  createAgent,
  createEvidenceFactory,
  createRateLimiter,
  generateSecureId,
  Quarantine,
  type Scent,
  type ThreatSignal,
} from '../src/index.js'

describe('Full Lifecycle Scenario', () => {
  let agent: Agent
  let quarantine: Quarantine
  let auditChain: AuditChain

  function createScent(payload: Record<string, unknown>, threat?: ThreatSignal): Scent {
    return {
      id: generateSecureId(),
      timestamp: Date.now(),
      source: '192.168.1.100',
      payload,
      threat,
    }
  }

  beforeEach(() => {
    auditChain = new AuditChain()
    quarantine = new Quarantine(
      { maxCount: 100, maxBytes: 10_000_000, evictionPolicy: 'priority' },
      auditChain
    )
    const rateLimiter = createRateLimiter({
      windowMs: 60_000,
      maxRequests: 5,
      blockDurationMs: 300_000,
    })
    const evidenceFactory = createEvidenceFactory()

    agent = createAgent(
      { maxPayloadSize: 1_000_000 },
      quarantine,
      rateLimiter,
      evidenceFactory
    ) as Agent
  })

  it('should process clean requests', () => {
    const scent = createScent({ action: 'login', user: 'alice' })
    const result = agent.intercept(scent)

    expect(result.status).toBe('clean')
    expect(quarantine.stats.count).toBe(0)
  })

  it('should quarantine threats', () => {
    const scent = createScent(
      { action: 'sql_injection', payload: "'; DROP TABLE users; --" },
      { category: 'injection', severity: 'critical' }
    )
    const result = agent.intercept(scent)

    expect(result.status).toBe('quarantined')
    expect(quarantine.stats.count).toBe(1)
    expect(quarantine.stats.bySeverity.critical).toBe(1)
  })

  it('should ignore duplicates', () => {
    const payload = { action: 'duplicate_attack' }
    const threat: ThreatSignal = { category: 'injection', severity: 'high' }

    const result1 = agent.intercept(createScent(payload, threat))
    const result2 = agent.intercept(createScent(payload, threat))

    expect(result1.status).toBe('quarantined')
    expect(result2.status).toBe('ignored')
    expect(quarantine.stats.count).toBe(1) // Only one in quarantine
  })

  it('should rate limit sources', () => {
    // Exhaust rate limit (5 requests)
    for (let i = 0; i < 5; i++) {
      agent.intercept(createScent({ request: i }))
    }

    // 6th request should be rate limited
    const result = agent.intercept(createScent({ request: 6 }))

    expect(result.status).toBe('rate_limited')
    if (result.status === 'rate_limited') {
      expect(result.retryAfter).toBeGreaterThan(0)
    }
  })

  it('should neutralize evidence and update audit chain', () => {
    const scent = createScent({ action: 'xss_attack' }, { category: 'injection', severity: 'high' })
    const result = agent.intercept(scent)

    if (result.status !== 'quarantined') {
      throw new Error('Expected quarantined')
    }

    const signature = result.handle.signature
    const record = quarantine.neutralize(signature)

    expect(record).not.toBeNull()
    expect(record!.status).toBe('neutralized')
    expect(auditChain.length).toBe(1)
    expect(quarantine.stats.count).toBe(0)
  })

  it('should purge evidence with reason', () => {
    const scent = createScent(
      { action: 'timeout_attack' },
      { category: 'ddos', severity: 'medium' }
    )
    const result = agent.intercept(scent)

    if (result.status !== 'quarantined') {
      throw new Error('Expected quarantined')
    }

    const signature = result.handle.signature
    const purgeRecord = quarantine.purge(signature, 'timeout')

    expect(purgeRecord).not.toBeNull()
    expect(purgeRecord!.reason).toBe('timeout')
    expect(quarantine.stats.count).toBe(0)
  })

  it('should replace evidence atomically', () => {
    // Insert first evidence
    const scent1 = createScent({ action: 'old_attack' }, { category: 'injection', severity: 'low' })
    const result1 = agent.intercept(scent1)

    if (result1.status !== 'quarantined') {
      throw new Error('Expected quarantined')
    }

    const oldSignature = result1.handle.signature

    // Create new evidence
    const scent2 = createScent(
      { action: 'new_attack' },
      { category: 'injection', severity: 'high' }
    )
    const factory = createEvidenceFactory()
    const newEvidenceResult = factory.create(scent2, scent2.threat!, 1_000_000)

    if (!newEvidenceResult.ok) {
      throw new Error('Failed to create evidence')
    }

    // Replace
    const replaceResult = quarantine.replace(oldSignature, newEvidenceResult.evidence)

    expect(replaceResult.status).toBe('replaced')
    expect(replaceResult.neutralized).toBeDefined()
    expect(replaceResult.inserted).toBe(true)
    expect(quarantine.stats.count).toBe(1)
    expect(auditChain.length).toBe(1) // Old evidence neutralized
  })

  it('should track agent statistics', () => {
    // Clean
    agent.intercept(createScent({ type: 'clean' }))

    // Quarantine
    agent.intercept(createScent({ type: 'attack' }, { category: 'injection', severity: 'high' }))

    // Duplicate
    agent.intercept(createScent({ type: 'attack' }, { category: 'injection', severity: 'high' }))

    const stats = agent.getStats()

    expect(stats.totalIntercepts).toBe(3)
    expect(stats.cleanCount).toBe(1)
    expect(stats.quarantinedCount).toBe(1)
    expect(stats.ignoredCount).toBe(1)
  })
})
