/**
 * Quarantine tests (TDD).
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { AuditChain } from '../src/core/audit-chain.js'
import { Evidence } from '../src/core/evidence.js'
import { Quarantine } from '../src/core/quarantine.js'
import type { QuarantineConfig } from '../src/types/config.js'
import { hashBuffer } from '../src/utils/hash.js'

describe('Quarantine', () => {
  let quarantine: Quarantine
  let auditChain: AuditChain
  let config: QuarantineConfig

  function createEvidence(
    signature: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    size: number = 1024
  ): Evidence {
    const bytes = new ArrayBuffer(size)
    const view = new Uint8Array(bytes)
    // Fill with unique data based on signature
    for (let i = 0; i < size; i++) {
      view[i] = signature.charCodeAt(i % signature.length)
    }
    const contentHash = hashBuffer(bytes)
    return new Evidence(bytes, signature, contentHash, severity, Date.now())
  }

  beforeEach(() => {
    config = {
      maxCount: 5,
      maxBytes: 10000,
      evictionPolicy: 'priority',
    }
    auditChain = new AuditChain()
    quarantine = new Quarantine(config, auditChain)
  })

  describe('construction', () => {
    it('initializes with empty store', () => {
      expect(quarantine.stats.count).toBe(0)
      expect(quarantine.stats.bytes).toBe(0)
    })

    it('accepts config and audit chain', () => {
      expect(quarantine).toBeDefined()
    })
  })

  describe('insert', () => {
    it('stores evidence by signature', () => {
      const evidence = createEvidence('sig1', 'high')
      const result = quarantine.insert(evidence)

      expect(result.status).toBe('inserted')
      expect(quarantine.has('sig1')).toBe(true)
    })

    it('increments count', () => {
      quarantine.insert(createEvidence('sig1', 'high'))
      expect(quarantine.stats.count).toBe(1)
    })

    it('increments total bytes', () => {
      quarantine.insert(createEvidence('sig1', 'high', 2048))
      expect(quarantine.stats.bytes).toBe(2048)
    })

    it('tracks multiple evidence', () => {
      quarantine.insert(createEvidence('sig1', 'high', 1000))
      quarantine.insert(createEvidence('sig2', 'medium', 2000))
      quarantine.insert(createEvidence('sig3', 'low', 3000))

      expect(quarantine.stats.count).toBe(3)
      expect(quarantine.stats.bytes).toBe(6000)
    })

    it('handles duplicate signature', () => {
      const e1 = createEvidence('sig1', 'high')
      const e2 = createEvidence('sig1-dup', 'high') // different content
      // Override signature to simulate duplicate
      Object.defineProperty(e2, '_signature', { value: 'sig1' })

      const r1 = quarantine.insert(e1)
      const r2 = quarantine.insert(e1) // same evidence

      expect(r1.status).toBe('inserted')
      expect(r2.status).toBe('duplicate')
      expect(quarantine.stats.count).toBe(1)
    })

    it('returns existing evidence on duplicate', () => {
      const e1 = createEvidence('sig1', 'high')
      quarantine.insert(e1)

      const result = quarantine.insert(e1)

      expect(result.status).toBe('duplicate')
      expect(result.existing).toBe(e1)
    })

    it('triggers eviction when count limit exceeded', () => {
      for (let i = 0; i < 6; i++) {
        quarantine.insert(createEvidence(`sig${i}`, 'low', 100))
      }
      expect(quarantine.stats.count).toBe(5)
    })

    it('triggers eviction when byte limit exceeded', () => {
      quarantine.insert(createEvidence('sig1', 'low', 6000))
      quarantine.insert(createEvidence('sig2', 'low', 5000))

      expect(quarantine.stats.bytes).toBeLessThanOrEqual(10000)
    })
  })

  describe('get', () => {
    it('returns evidence by signature', () => {
      const evidence = createEvidence('sig1', 'high')
      quarantine.insert(evidence)

      const retrieved = quarantine.get('sig1')
      expect(retrieved).toBe(evidence)
    })

    it('returns null for unknown signature', () => {
      expect(quarantine.get('unknown')).toBeNull()
    })
  })

  describe('has', () => {
    it('returns true for stored signature', () => {
      quarantine.insert(createEvidence('sig1', 'high'))
      expect(quarantine.has('sig1')).toBe(true)
    })

    it('returns false for unknown signature', () => {
      expect(quarantine.has('unknown')).toBe(false)
    })
  })

  describe('neutralize', () => {
    it('neutralizes and removes evidence', () => {
      quarantine.insert(createEvidence('sig1', 'high'))
      const record = quarantine.neutralize('sig1')

      expect(record).toBeDefined()
      expect(quarantine.has('sig1')).toBe(false)
    })

    it('decrements count', () => {
      quarantine.insert(createEvidence('sig1', 'high'))
      quarantine.insert(createEvidence('sig2', 'high'))
      quarantine.neutralize('sig1')

      expect(quarantine.stats.count).toBe(1)
    })

    it('decrements total bytes', () => {
      quarantine.insert(createEvidence('sig1', 'high', 2048))
      quarantine.neutralize('sig1')

      expect(quarantine.stats.bytes).toBe(0)
    })

    it('returns neutralization record', () => {
      quarantine.insert(createEvidence('sig1', 'high'))
      const record = quarantine.neutralize('sig1')

      expect(record?.signature).toBe('sig1')
      expect(record?.status).toBe('neutralized')
    })

    it('returns null for unknown signature', () => {
      expect(quarantine.neutralize('unknown')).toBeNull()
    })

    it('cannot neutralize twice', () => {
      quarantine.insert(createEvidence('sig1', 'high'))
      quarantine.neutralize('sig1')

      expect(quarantine.neutralize('sig1')).toBeNull()
    })

    it('appends to audit chain', () => {
      const initialLength = auditChain.length
      quarantine.insert(createEvidence('sig1', 'high'))
      quarantine.neutralize('sig1')

      expect(auditChain.length).toBe(initialLength + 1)
    })
  })

  describe('flush', () => {
    it('neutralizes all evidence', () => {
      quarantine.insert(createEvidence('sig1', 'high'))
      quarantine.insert(createEvidence('sig2', 'medium'))
      quarantine.insert(createEvidence('sig3', 'low'))

      const records = quarantine.flush()

      expect(records).toHaveLength(3)
      expect(quarantine.stats.count).toBe(0)
    })

    it('returns all neutralization records', () => {
      quarantine.insert(createEvidence('sig1', 'high'))
      quarantine.insert(createEvidence('sig2', 'medium'))

      const records = quarantine.flush()

      expect(records.every((r) => r.status === 'neutralized')).toBe(true)
    })

    it('clears store', () => {
      quarantine.insert(createEvidence('sig1', 'high'))
      quarantine.insert(createEvidence('sig2', 'high'))
      quarantine.flush()

      expect(quarantine.has('sig1')).toBe(false)
      expect(quarantine.has('sig2')).toBe(false)
    })

    it('resets byte counter', () => {
      quarantine.insert(createEvidence('sig1', 'high', 5000))
      quarantine.flush()

      expect(quarantine.stats.bytes).toBe(0)
    })

    it('handles empty quarantine', () => {
      const records = quarantine.flush()
      expect(records).toEqual([])
    })
  })

  describe('eviction', () => {
    it('evicts lowest severity first', () => {
      quarantine.insert(createEvidence('low1', 'low', 100))
      quarantine.insert(createEvidence('med1', 'medium', 100))
      quarantine.insert(createEvidence('high1', 'high', 100))
      quarantine.insert(createEvidence('crit1', 'critical', 100))
      quarantine.insert(createEvidence('low2', 'low', 100))
      quarantine.insert(createEvidence('low3', 'low', 100)) // triggers eviction

      expect(quarantine.has('low1')).toBe(false) // evicted
      expect(quarantine.has('high1')).toBe(true)
      expect(quarantine.has('crit1')).toBe(true)
    })

    it('respects count limit', () => {
      for (let i = 0; i < 10; i++) {
        quarantine.insert(createEvidence(`sig${i}`, 'low', 100))
      }
      expect(quarantine.stats.count).toBe(5)
    })

    it('respects byte limit', () => {
      for (let i = 0; i < 20; i++) {
        quarantine.insert(createEvidence(`sig${i}`, 'low', 1000))
      }
      expect(quarantine.stats.bytes).toBeLessThanOrEqual(10000)
    })

    it('evicts multiple if needed', () => {
      for (let i = 0; i < 5; i++) {
        quarantine.insert(createEvidence(`small${i}`, 'low', 500))
      }
      quarantine.insert(createEvidence('large', 'high', 8000))

      expect(quarantine.stats.bytes).toBeLessThanOrEqual(10000)
      expect(quarantine.has('large')).toBe(true)
    })
  })

  describe('stats', () => {
    it('reports current count', () => {
      quarantine.insert(createEvidence('sig1', 'high'))
      quarantine.insert(createEvidence('sig2', 'medium'))

      expect(quarantine.stats.count).toBe(2)
    })

    it('reports current bytes', () => {
      quarantine.insert(createEvidence('sig1', 'high', 2000))
      quarantine.insert(createEvidence('sig2', 'medium', 3000))

      expect(quarantine.stats.bytes).toBe(5000)
    })

    it('reports by severity', () => {
      quarantine.insert(createEvidence('sig1', 'high', 100))
      quarantine.insert(createEvidence('sig2', 'high', 100))
      quarantine.insert(createEvidence('sig3', 'low', 100))

      const stats = quarantine.stats
      expect(stats.bySeverity.high).toBe(2)
      expect(stats.bySeverity.low).toBe(1)
      expect(stats.bySeverity.medium).toBe(0)
    })

    it('updates after operations', () => {
      quarantine.insert(createEvidence('sig1', 'high', 1000))
      expect(quarantine.stats.count).toBe(1)

      quarantine.neutralize('sig1')
      expect(quarantine.stats.count).toBe(0)
      expect(quarantine.stats.bytes).toBe(0)
    })
  })
})
