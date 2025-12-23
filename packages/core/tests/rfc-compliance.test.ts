/**
 * RFC-0000 Compliance Tests
 *
 * These tests verify that the implementation adheres to the RFC specification.
 * Each test references specific RFC sections and invariants.
 */

import { describe, expect, it } from 'vitest'
import { Agent } from '../src/core/agent.js'
import { AuditChain } from '../src/core/audit-chain.js'
import { createEvidenceFactory, EvidenceFactory } from '../src/core/evidence-factory.js'
import { Evidence } from '../src/core/evidence.js'
import { Quarantine } from '../src/core/quarantine.js'
import { createRateLimiter } from '../src/core/rate-limiter.js'
import type { Scent } from '../src/types/scent.js'
import { encodePayload } from '../src/utils/encode.js'
import { hashBuffer } from '../src/utils/hash.js'

describe('RFC-0000 Compliance', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // RFC Section: Detection Model
  // "Tracehound threat detection YAPMAZ"
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Detection Model Compliance', () => {
    it('Agent does NOT perform threat detection - clean without threat signal', () => {
      const { agent } = createTestSetup()

      // Scent without threat signal (external detector said "clean")
      const scent: Scent = {
        id: 'test-1',
        payload: { suspicious: 'data', sql: "'; DROP TABLE users; --" },
        source: '192.168.1.1',
        timestamp: Date.now(),
        // No threat signal = external detector did not flag this
      }

      const result = agent.intercept(scent)

      // RFC: "No external threat signal = no quarantine"
      expect(result.status).toBe('clean')
    })

    it('Agent quarantines ONLY when external threat signal present', () => {
      const { agent, quarantine } = createTestSetup()

      const scent: Scent = {
        id: 'test-2',
        payload: { attack: 'sql injection' },
        source: '192.168.1.1',
        timestamp: Date.now(),
        threat: { category: 'injection', severity: 'high' },
      }

      const result = agent.intercept(scent)

      expect(result.status).toBe('quarantined')
      expect(quarantine.stats.count).toBe(1)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // RFC Section: Intent (Threat Signature)
  // "Signature = category + content hash"
  // "Farklı payload = farklı signature (collision impossible)"
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Signature Generation Compliance', () => {
    it('signature format matches RFC: category:sha256hash', () => {
      const factory = new EvidenceFactory()
      const scent: Scent = {
        id: 'sig-test',
        payload: { test: 'data' },
        source: 'test',
        timestamp: Date.now(),
      }

      const result = factory.create(scent, { category: 'injection', severity: 'high' }, 1_000_000)

      expect(result.ok).toBe(true)
      if (result.ok) {
        // RFC format: {category}:{sha256}
        expect(result.signature).toMatch(/^injection:[a-f0-9]{64}$/)
      }
    })

    it('signature = sha256(serialize(payload)) - verifiable', () => {
      const factory = new EvidenceFactory()
      const payload = { test: 'data', nested: { value: 123 } }
      const scent: Scent = {
        id: 'sig-verify',
        payload,
        source: 'test',
        timestamp: Date.now(),
      }

      const result = factory.create(scent, { category: 'injection', severity: 'high' }, 1_000_000)

      // Manually compute expected hash
      const encoded = encodePayload(payload, 1_000_000)
      const expectedHash = hashBuffer(encoded.bytes)
      const expectedSignature = `injection:${expectedHash}`

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.signature).toBe(expectedSignature)
      }
    })

    it('different payload = different signature (collision impossible)', () => {
      const factory = new EvidenceFactory()

      const scent1: Scent = {
        id: 'collision-1',
        payload: { data: 'payload-A' },
        source: 'test',
        timestamp: Date.now(),
      }

      const scent2: Scent = {
        id: 'collision-2',
        payload: { data: 'payload-B' }, // Different content
        source: 'test',
        timestamp: Date.now(),
      }

      const result1 = factory.create(scent1, { category: 'injection', severity: 'high' }, 1_000_000)
      const result2 = factory.create(scent2, { category: 'injection', severity: 'high' }, 1_000_000)

      expect(result1.ok && result2.ok).toBe(true)
      if (result1.ok && result2.ok) {
        expect(result1.signature).not.toBe(result2.signature)
      }
    })

    it('same payload = same signature (deterministic)', () => {
      const factory = new EvidenceFactory()
      const payload = { attack: 'test', level: 5 }

      const scent1: Scent = {
        id: 'deterministic-1',
        payload: { ...payload },
        source: 'test',
        timestamp: Date.now(),
      }

      const scent2: Scent = {
        id: 'deterministic-2',
        payload: { level: 5, attack: 'test' }, // Same content, different key order
        source: 'test',
        timestamp: Date.now(),
      }

      const result1 = factory.create(scent1, { category: 'ddos', severity: 'high' }, 1_000_000)
      const result2 = factory.create(scent2, { category: 'ddos', severity: 'high' }, 1_000_000)

      expect(result1.ok && result2.ok).toBe(true)
      if (result1.ok && result2.ok) {
        expect(result1.signature).toBe(result2.signature) // MUST match
      }
    })

    it('different category = different signature', () => {
      const factory = new EvidenceFactory()
      const payload = { attack: 'test' }

      const scent: Scent = {
        id: 'category-test',
        payload,
        source: 'test',
        timestamp: Date.now(),
      }

      const result1 = factory.create(scent, { category: 'injection', severity: 'high' }, 1_000_000)
      const result2 = factory.create(scent, { category: 'ddos', severity: 'high' }, 1_000_000)

      expect(result1.ok && result2.ok).toBe(true)
      if (result1.ok && result2.ok) {
        expect(result1.signature).not.toBe(result2.signature)
      }
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // RFC Section: Davranış Kuralları
  // "Aynı Intent (Known Threat) → IGNORE"
  // "Yeni Intent (New Threat) → ENCODE + QUARANTINE"
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Behavior Rules Compliance', () => {
    it('same intent = IGNORE (duplicate signature)', () => {
      const { agent } = createTestSetup()
      const payload = { attack: 'known threat' }

      const scent1: Scent = {
        id: 'intent-1',
        payload,
        source: '10.0.0.1',
        timestamp: Date.now(),
        threat: { category: 'spam', severity: 'low' },
      }

      const scent2: Scent = {
        id: 'intent-2',
        payload, // Same payload
        source: '10.0.0.2', // Different source doesn't matter
        timestamp: Date.now() + 1000,
        threat: { category: 'spam', severity: 'low' }, // Same category
      }

      const result1 = agent.intercept(scent1)
      const result2 = agent.intercept(scent2)

      expect(result1.status).toBe('quarantined')
      expect(result2.status).toBe('ignored') // RFC: "Zaten quarantine'de evidence var"
    })

    it('new intent = QUARANTINE', () => {
      const { agent, quarantine } = createTestSetup()

      const scent1: Scent = {
        id: 'new-1',
        payload: { attack: 'type-A' },
        source: 'test',
        timestamp: Date.now(),
        threat: { category: 'injection', severity: 'high' },
      }

      const scent2: Scent = {
        id: 'new-2',
        payload: { attack: 'type-B' }, // Different payload = new intent
        source: 'test',
        timestamp: Date.now(),
        threat: { category: 'injection', severity: 'high' },
      }

      agent.intercept(scent1)
      agent.intercept(scent2)

      expect(quarantine.stats.count).toBe(2) // Both quarantined
    })

    it('old evidence NOT flushed on new intent (evidence preserve)', () => {
      const { agent, quarantine } = createTestSetup()

      // First threat
      const scent1: Scent = {
        id: 'preserve-1',
        payload: { attack: 'first' },
        source: 'test',
        timestamp: Date.now(),
        threat: { category: 'injection', severity: 'high' },
      }
      const result1 = agent.intercept(scent1)

      // Second threat
      const scent2: Scent = {
        id: 'preserve-2',
        payload: { attack: 'second' },
        source: 'test',
        timestamp: Date.now(),
        threat: { category: 'injection', severity: 'high' },
      }
      agent.intercept(scent2)

      // First evidence should still exist
      if (result1.status === 'quarantined') {
        const evidence = quarantine.get(result1.handle.signature)
        expect(evidence).not.toBeNull()
      }
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // RFC Section: Memory Model: Atomic Ownership
  // "neutralize() → atomic(snapshot + destroy)"
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Atomic Ownership Compliance', () => {
    it('neutralize is atomic: snapshot created before destroy', () => {
      const payload = { sensitive: 'data' }
      const encoded = encodePayload(payload, 1_000_000)
      const hash = hashBuffer(encoded.bytes)

      const evidence = new Evidence(
        encoded.bytes.buffer as ArrayBuffer,
        `injection:${hash}`,
        hash,
        'high',
        Date.now()
      )

      const record = evidence.neutralize('previous-hash')

      // Record should have snapshot data
      expect(record.signature).toBe(`injection:${hash}`)
      expect(record.hash).toBe(hash)
      expect(record.size).toBe(encoded.size)
      expect(record.status).toBe('neutralized')

      // Evidence should be disposed
      expect(evidence.disposed).toBe(true)
    })

    it('disposed evidence throws on access', () => {
      const encoded = encodePayload({ test: 'data' }, 1_000_000)
      const hash = hashBuffer(encoded.bytes)

      const evidence = new Evidence(
        encoded.bytes.buffer as ArrayBuffer,
        `injection:${hash}`,
        hash,
        'high',
        Date.now()
      )

      evidence.neutralize('')

      expect(() => evidence.transfer()).toThrow()
      expect(() => evidence.neutralize('')).toThrow()
      expect(() => evidence.evacuate('dest')).toThrow()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // RFC Section: Security Layer: Rate Limiting
  // "Early rejection before Agent processing"
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Rate Limiting Compliance', () => {
    it('rate limiting happens BEFORE payload processing', () => {
      const { agent } = createTestSetup({ maxRequests: 1 })

      // First request
      agent.intercept({
        id: 'rl-1',
        payload: { data: 'first' },
        source: 'blocked-source',
        timestamp: Date.now(),
        threat: { category: 'injection', severity: 'high' },
      })

      // Second request should be rate limited
      // Even with huge payload, it should be rejected before processing
      const result = agent.intercept({
        id: 'rl-2',
        payload: { data: 'x'.repeat(10000) }, // Large payload
        source: 'blocked-source', // Same source
        timestamp: Date.now(),
        threat: { category: 'injection', severity: 'high' },
      })

      expect(result.status).toBe('rate_limited')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // RFC Section: Audit Chain Integrity
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Audit Chain Compliance', () => {
    it('audit chain maintains cryptographic integrity', () => {
      const auditChain = new AuditChain()
      const encoded1 = encodePayload({ a: 1 }, 1_000_000)
      const encoded2 = encodePayload({ b: 2 }, 1_000_000)

      const evidence1 = new Evidence(
        encoded1.bytes.buffer as ArrayBuffer,
        'injection:hash1',
        hashBuffer(encoded1.bytes),
        'high',
        Date.now()
      )

      const evidence2 = new Evidence(
        encoded2.bytes.buffer as ArrayBuffer,
        'injection:hash2',
        hashBuffer(encoded2.bytes),
        'high',
        Date.now()
      )

      const record1 = evidence1.neutralize(auditChain.lastHash)
      auditChain.append(record1)

      const record2 = evidence2.neutralize(auditChain.lastHash)
      auditChain.append(record2)

      // Chain should be verifiable
      expect(auditChain.verify()).toBe(true)
    })

    it('audit chain detects tampering', () => {
      const auditChain = new AuditChain()
      const encoded = encodePayload({ test: 'data' }, 1_000_000)

      const evidence = new Evidence(
        encoded.bytes.buffer as ArrayBuffer,
        'injection:hash',
        hashBuffer(encoded.bytes),
        'high',
        Date.now()
      )

      const record = evidence.neutralize(auditChain.lastHash)
      auditChain.append(record)

      // Tamper with internal state (simulate attack)
      const records = (auditChain as any).records
      if (records.length > 0) {
        records[0].hash = 'tampered-hash'
      }

      // Verification should fail
      expect(auditChain.verify()).toBe(false)
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
