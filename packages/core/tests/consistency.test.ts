/**
 * Consistency Tests
 *
 * These tests verify that cross-component invariants hold.
 * Focus on system-level consistency, not individual component behavior.
 */

import { describe, expect, it } from 'vitest'
import { Agent } from '../src/core/agent.js'
import { AuditChain } from '../src/core/audit-chain.js'
import { createEvidenceFactory, EvidenceFactory } from '../src/core/evidence-factory.js'
import { Quarantine } from '../src/core/quarantine.js'
import { createRateLimiter } from '../src/core/rate-limiter.js'
import type { Scent } from '../src/types/scent.js'
import { generateSignature } from '../src/types/signature.js'
import { encodePayload } from '../src/utils/encode.js'
import { hashBuffer } from '../src/utils/hash.js'

describe('Cross-Component Consistency', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // Signature Generation Consistency
  // Factory and generateSignature MUST produce identical results
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Signature Generation Consistency', () => {
    it('EvidenceFactory and generateSignature produce identical signatures', () => {
      const factory = new EvidenceFactory()
      const payload = { test: 'consistency', nested: { value: 42 } }

      const scent: Scent = {
        id: 'consistency-1',
        payload,
        source: 'test',
        timestamp: Date.now(),
      }

      // Via EvidenceFactory
      const factoryResult = factory.create(
        scent,
        { category: 'injection', severity: 'high' },
        1_000_000
      )

      // Via generateSignature
      const legacySignature = generateSignature({
        category: 'injection',
        severity: 'high',
        scent,
      })

      expect(factoryResult.ok).toBe(true)
      if (factoryResult.ok) {
        expect(factoryResult.signature).toBe(legacySignature)
      }
    })

    it('encodePayload + hashBuffer matches EvidenceFactory hash', () => {
      const factory = new EvidenceFactory()
      const payload = { data: 'hash consistency test' }

      const scent: Scent = {
        id: 'hash-consistency',
        payload,
        source: 'test',
        timestamp: Date.now(),
      }

      // Via EvidenceFactory
      const factoryResult = factory.create(scent, { category: 'ddos', severity: 'low' }, 1_000_000)

      // Manual computation
      const encoded = encodePayload(payload, 1_000_000)
      const manualHash = hashBuffer(encoded.bytes)

      expect(factoryResult.ok).toBe(true)
      if (factoryResult.ok) {
        expect(factoryResult.hash).toBe(manualHash)
      }
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Agent → Quarantine Consistency
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Agent-Quarantine Consistency', () => {
    it('quarantined result handle matches quarantine.get(signature)', () => {
      const { agent, quarantine } = createTestSetup()

      const scent: Scent = {
        id: 'aq-consistency',
        payload: { attack: 'test' },
        source: 'test',
        timestamp: Date.now(),
        threat: { category: 'injection', severity: 'high' },
      }

      const result = agent.intercept(scent)

      expect(result.status).toBe('quarantined')
      if (result.status === 'quarantined') {
        const fromQuarantine = quarantine.get(result.handle.signature)
        expect(fromQuarantine).not.toBeNull()
        expect(fromQuarantine?.signature).toBe(result.handle.signature)
      }
    })

    it('ignored result signature exists in quarantine', () => {
      const { agent, quarantine } = createTestSetup()
      const payload = { duplicate: 'test' }

      const scent1: Scent = {
        id: 'dup-1',
        payload,
        source: 'test',
        timestamp: Date.now(),
        threat: { category: 'spam', severity: 'low' },
      }

      const scent2: Scent = {
        id: 'dup-2',
        payload, // Same payload
        source: 'other',
        timestamp: Date.now(),
        threat: { category: 'spam', severity: 'low' },
      }

      agent.intercept(scent1)
      const result = agent.intercept(scent2)

      expect(result.status).toBe('ignored')
      if (result.status === 'ignored') {
        expect(quarantine.has(result.signature)).toBe(true)
      }
    })

    it('quarantine count matches successful quarantine operations', () => {
      const { agent, quarantine } = createTestSetup()

      const payloads = [
        { attack: 'A' },
        { attack: 'B' },
        { attack: 'C' },
        { attack: 'A' }, // Duplicate
        { attack: 'D' },
      ]

      let expectedCount = 0
      for (const payload of payloads) {
        const result = agent.intercept({
          id: `count-${expectedCount}`,
          payload,
          source: 'test',
          timestamp: Date.now(),
          threat: { category: 'injection', severity: 'high' },
        })

        if (result.status === 'quarantined') {
          expectedCount++
        }
      }

      expect(quarantine.stats.count).toBe(expectedCount)
      expect(expectedCount).toBe(4) // A, B, C, D (A duplicate ignored)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Rate Limiter Consistency
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Rate Limiter Consistency', () => {
    it('rate limited counts match agent stats', () => {
      const { agent } = createTestSetup({ maxRequests: 2 })

      // Make requests
      for (let i = 0; i < 5; i++) {
        agent.intercept({
          id: `rl-${i}`,
          payload: { data: i },
          source: 'same-source',
          timestamp: Date.now(),
        })
      }

      const stats = agent.getStats()

      // First 2 should be clean, rest rate limited
      expect(stats.cleanCount).toBe(2)
      expect(stats.rateLimitedCount).toBe(3)
      expect(stats.totalIntercepts).toBe(5)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Audit Chain Consistency
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Audit Chain Consistency', () => {
    it('audit chain length matches neutralization count', () => {
      const { agent, quarantine, auditChain } = createTestSetup()

      // Create multiple threats
      const signatures: string[] = []
      for (let i = 0; i < 3; i++) {
        const result = agent.intercept({
          id: `audit-${i}`,
          payload: { threat: i },
          source: 'test',
          timestamp: Date.now(),
          threat: { category: 'malware', severity: 'high' },
        })

        if (result.status === 'quarantined') {
          signatures.push(result.handle.signature)
        }
      }

      // Neutralize all
      for (const sig of signatures) {
        quarantine.neutralize(sig)
      }

      expect(auditChain.length).toBe(signatures.length)
    })

    it('audit chain records match neutralized evidence', () => {
      const { agent, quarantine, auditChain } = createTestSetup()

      const result = agent.intercept({
        id: 'audit-match',
        payload: { sensitive: 'data' },
        source: 'test',
        timestamp: Date.now(),
        threat: { category: 'injection', severity: 'high' },
      })

      expect(result.status).toBe('quarantined')
      if (result.status === 'quarantined') {
        const signature = result.handle.signature

        quarantine.neutralize(signature)

        // Access records via internal property (for testing only)
        const records = (auditChain as any).records
        expect(records.length).toBe(1)
        expect(records[0].signature).toBe(signature)
      }
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Evidence Consistency
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Evidence Consistency', () => {
    it('evidence size matches encoded payload size', () => {
      const { agent, quarantine } = createTestSetup()
      const payload = { large: 'x'.repeat(1000) }

      const result = agent.intercept({
        id: 'size-check',
        payload,
        source: 'test',
        timestamp: Date.now(),
        threat: { category: 'spam', severity: 'low' },
      })

      expect(result.status).toBe('quarantined')
      if (result.status === 'quarantined') {
        const encoded = encodePayload(payload, 1_000_000)
        expect(result.handle.size).toBe(encoded.size)
      }
    })

    it('evidence hash is verifiable after transfer', () => {
      const { agent, quarantine } = createTestSetup()
      const payload = { verify: 'hash consistency' }

      const result = agent.intercept({
        id: 'hash-verify',
        payload,
        source: 'test',
        timestamp: Date.now(),
        threat: { category: 'ddos', severity: 'high' },
      })

      expect(result.status).toBe('quarantined')
      if (result.status === 'quarantined') {
        const bytes = result.handle.transfer()
        const computedHash = hashBuffer(new Uint8Array(bytes))

        expect(computedHash).toBe(result.handle.hash)
      }
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Test Helpers
// ═══════════════════════════════════════════════════════════════════════════

function createTestSetup(options: { maxRequests?: number } = {}) {
  const auditChain = new AuditChain()
  const quarantine = new Quarantine(
    { maxCount: 1000, maxBytes: 10_000_000, evictionPolicy: 'priority' },
    auditChain
  )
  const rateLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: options.maxRequests ?? 100,
    blockDurationMs: 300_000,
  })
  const evidenceFactory = createEvidenceFactory()

  const agent = new Agent({ maxPayloadSize: 1_000_000 }, quarantine, rateLimiter, evidenceFactory)

  return { agent, quarantine, auditChain, rateLimiter }
}
