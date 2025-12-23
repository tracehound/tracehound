/**
 * Agent tests - core intercept flow.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { Agent, createAgent } from '../src/core/agent.js'
import { AuditChain } from '../src/core/audit-chain.js'
import { createEvidenceFactory } from '../src/core/evidence-factory.js'
import { Quarantine } from '../src/core/quarantine.js'
import { createRateLimiter } from '../src/core/rate-limiter.js'
import type { JsonSerializable, QuarantineConfig, RateLimitConfig } from '../src/types/index.js'
import type { Scent } from '../src/types/scent.js'

describe('Agent', () => {
  let agent: Agent
  let quarantine: Quarantine
  let auditChain: AuditChain

  const rateLimitConfig: RateLimitConfig = {
    windowMs: 60_000,
    maxRequests: 100,
    blockDurationMs: 300_000,
  }

  const quarantineConfig: QuarantineConfig = {
    maxCount: 1000,
    maxBytes: 10_000_000,
    evictionPolicy: 'priority',
  }

  const agentConfig = {
    maxPayloadSize: 1_000_000,
  }

  function createScent(
    payload: JsonSerializable,
    threat?: { category: 'injection' | 'ddos'; severity: 'low' | 'high' }
  ): Scent {
    return {
      id: `scent-${Date.now()}-${Math.random()}`,
      payload,
      source: '127.0.0.1',
      timestamp: Date.now(),
      threat,
    }
  }

  beforeEach(() => {
    auditChain = new AuditChain()
    quarantine = new Quarantine(quarantineConfig, auditChain)
    const rateLimiter = createRateLimiter(rateLimitConfig)
    const evidenceFactory = createEvidenceFactory()

    agent = new Agent(agentConfig, quarantine, rateLimiter, evidenceFactory)
  })

  describe('construction', () => {
    it('creates with valid config', () => {
      expect(agent).toBeDefined()
    })

    it('throws on non-positive maxPayloadSize', () => {
      expect(() => {
        new Agent(
          { maxPayloadSize: 0 },
          quarantine,
          createRateLimiter(rateLimitConfig),
          createEvidenceFactory()
        )
      }).toThrow('maxPayloadSize must be positive')
    })
  })

  describe('intercept - clean flow', () => {
    it('returns clean when no threat signal', () => {
      const scent = createScent({ data: 'test' })
      const result = agent.intercept(scent)

      expect(result.status).toBe('clean')
    })

    it('does not quarantine clean scents', () => {
      const scent = createScent({ data: 'test' })
      agent.intercept(scent)

      expect(quarantine.stats.count).toBe(0)
    })
  })

  describe('intercept - rate limiting', () => {
    it('returns rate_limited when source blocked', () => {
      const limitedConfig: RateLimitConfig = {
        windowMs: 60_000,
        maxRequests: 2,
        blockDurationMs: 1000,
      }

      const rateLimiter = createRateLimiter(limitedConfig)
      const localAgent = new Agent(agentConfig, quarantine, rateLimiter, createEvidenceFactory())

      // Use up limit
      localAgent.intercept(createScent({ data: 1 }))
      localAgent.intercept(createScent({ data: 2 }))

      // Third should be rate limited
      const result = localAgent.intercept(createScent({ data: 3 }))
      expect(result.status).toBe('rate_limited')
      if (result.status === 'rate_limited') {
        expect(result.retryAfter).toBeGreaterThan(0)
      }
    })
  })

  describe('intercept - payload validation', () => {
    it('returns payload_too_large for oversized payload', () => {
      const smallAgent = new Agent(
        { maxPayloadSize: 10 },
        quarantine,
        createRateLimiter(rateLimitConfig),
        createEvidenceFactory()
      )

      const scent = createScent(
        { data: 'x'.repeat(100) },
        { category: 'injection', severity: 'high' }
      )

      const result = smallAgent.intercept(scent)
      expect(result.status).toBe('payload_too_large')
      if (result.status === 'payload_too_large') {
        expect(result.limit).toBe(10)
      }
    })

    it('returns error for invalid payload', () => {
      const scent: Scent = {
        id: 'test',
        payload: { value: NaN } as any,
        source: '127.0.0.1',
        timestamp: Date.now(),
        threat: { category: 'injection', severity: 'high' },
      }

      const result = agent.intercept(scent)
      expect(result.status).toBe('error')
    })
  })

  describe('intercept - quarantine flow', () => {
    it('returns quarantined for new threat', () => {
      const scent = createScent(
        { attack: 'sql injection' },
        { category: 'injection', severity: 'high' }
      )

      const result = agent.intercept(scent)
      expect(result.status).toBe('quarantined')
      if (result.status === 'quarantined') {
        expect(result.handle).toBeDefined()
        expect(result.handle.disposed).toBe(false)
      }
    })

    it('inserts evidence into quarantine', () => {
      const scent = createScent({ attack: 'test' }, { category: 'injection', severity: 'high' })

      agent.intercept(scent)
      expect(quarantine.stats.count).toBe(1)
    })

    it('appends to audit chain', () => {
      // Note: Audit chain is only updated on neutralize, not on insert
      // This test verifies the quarantine → audit chain connection works
      const scent = createScent({ attack: 'test' }, { category: 'injection', severity: 'high' })

      const result = agent.intercept(scent)
      if (result.status === 'quarantined') {
        // Neutralize to trigger audit chain
        quarantine.neutralize(result.handle.signature)
        expect(auditChain.length).toBe(1)
      }
    })
  })

  describe('intercept - duplicate detection', () => {
    it('returns ignored for duplicate signature', () => {
      const payload = { attack: 'same payload' }

      const scent1 = createScent(payload, { category: 'injection', severity: 'high' })
      const scent2 = createScent(payload, { category: 'injection', severity: 'high' })

      const result1 = agent.intercept(scent1)
      const result2 = agent.intercept(scent2)

      expect(result1.status).toBe('quarantined')
      expect(result2.status).toBe('ignored')
      if (result2.status === 'ignored') {
        expect(result2.signature).toBeDefined()
      }
    })

    it('does not add duplicate to quarantine', () => {
      const payload = { attack: 'duplicate' }

      agent.intercept(createScent(payload, { category: 'injection', severity: 'high' }))
      agent.intercept(createScent(payload, { category: 'injection', severity: 'high' }))

      expect(quarantine.stats.count).toBe(1)
    })

    // CRITICAL: Deterministic duplicate test
    it('produces identical signature for deep-equal payloads with different key order', () => {
      const payload1 = { a: 1, b: { c: 2, d: 3 }, e: 4 }
      const payload2 = { e: 4, b: { d: 3, c: 2 }, a: 1 } // Same content, different order

      const scent1 = createScent(payload1, { category: 'injection', severity: 'high' })
      const scent2 = createScent(payload2, { category: 'injection', severity: 'high' })

      const result1 = agent.intercept(scent1)
      const result2 = agent.intercept(scent2)

      expect(result1.status).toBe('quarantined')
      expect(result2.status).toBe('ignored') // MUST match - deterministic signature
    })

    it('treats different categories as different signatures', () => {
      const payload = { attack: 'test' }

      const scent1 = createScent(payload, { category: 'injection', severity: 'high' })
      const scent2 = createScent(payload, { category: 'ddos', severity: 'high' })

      const result1 = agent.intercept(scent1)
      const result2 = agent.intercept(scent2)

      expect(result1.status).toBe('quarantined')
      expect(result2.status).toBe('quarantined') // Different category = different signature
      expect(quarantine.stats.count).toBe(2)
    })
  })

  describe('getStats', () => {
    it('tracks totalIntercepts', () => {
      agent.intercept(createScent({ a: 1 }))
      agent.intercept(createScent({ a: 2 }))

      expect(agent.getStats().totalIntercepts).toBe(2)
    })

    it('tracks cleanCount', () => {
      agent.intercept(createScent({ a: 1 })) // No threat = clean
      agent.intercept(createScent({ a: 2 })) // No threat = clean

      expect(agent.getStats().cleanCount).toBe(2)
    })

    it('tracks quarantinedCount', () => {
      agent.intercept(createScent({ a: 1 }, { category: 'injection', severity: 'high' }))
      agent.intercept(createScent({ a: 2 }, { category: 'injection', severity: 'high' }))

      expect(agent.getStats().quarantinedCount).toBe(2)
    })

    it('tracks ignoredCount', () => {
      const payload = { attack: 'dup' }
      agent.intercept(createScent(payload, { category: 'injection', severity: 'high' }))
      agent.intercept(createScent(payload, { category: 'injection', severity: 'high' }))

      expect(agent.getStats().ignoredCount).toBe(1)
    })
  })

  describe('createAgent factory', () => {
    it('creates an agent instance', () => {
      const agentInstance = createAgent(
        agentConfig,
        quarantine,
        createRateLimiter(rateLimitConfig),
        createEvidenceFactory()
      )

      expect(agentInstance).toBeDefined()
    })
  })
})
