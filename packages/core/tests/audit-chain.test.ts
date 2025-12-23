/**
 * AuditChain tests (TDD).
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { AuditChain, GENESIS_HASH } from '../src/core/audit-chain.js'
import type { NeutralizationRecord } from '../src/types/evidence.js'

function createRecord(id: string, overrides?: Partial<NeutralizationRecord>): NeutralizationRecord {
  return {
    id,
    signature: `sig-${id}`,
    hash: `hash-${id}`,
    size: 100,
    status: 'neutralized',
    timestamp: Date.now(),
    previousHash: GENESIS_HASH,
    ...overrides,
  }
}

describe('AuditChain', () => {
  let chain: AuditChain

  beforeEach(() => {
    chain = new AuditChain()
  })

  describe('construction', () => {
    it('initializes with genesis hash', () => {
      expect(chain.lastHash).toBe(GENESIS_HASH)
    })

    it('initializes with zero length', () => {
      expect(chain.length).toBe(0)
    })
  })

  describe('append', () => {
    it('appends neutralization record', () => {
      const record = createRecord('test-1')
      chain.append(record)

      expect(chain.length).toBe(1)
      expect(chain.lastHash).not.toBe(GENESIS_HASH)
    })

    it('chains multiple records', () => {
      chain.append(createRecord('1'))
      const hash1 = chain.lastHash

      chain.append(createRecord('2'))
      const hash2 = chain.lastHash

      chain.append(createRecord('3'))
      const hash3 = chain.lastHash

      expect(hash1).not.toBe(hash2)
      expect(hash2).not.toBe(hash3)
      expect(chain.length).toBe(3)
    })

    it('updates lastHash after each append', () => {
      const before = chain.lastHash
      chain.append(createRecord('test'))
      const after = chain.lastHash

      expect(after).not.toBe(before)
      expect(after).toHaveLength(64)
    })
  })

  describe('verify', () => {
    it('verifies empty chain', () => {
      expect(chain.verify()).toBe(true)
    })

    it('verifies single record', () => {
      chain.append(createRecord('test'))
      expect(chain.verify()).toBe(true)
    })

    it('verifies multiple records', () => {
      for (let i = 0; i < 5; i++) {
        chain.append(createRecord(`id-${i}`))
      }
      expect(chain.verify()).toBe(true)
    })
  })

  describe('export', () => {
    it('exports empty array for empty chain', () => {
      expect(chain.export()).toEqual([])
    })

    it('exports all records', () => {
      chain.append(createRecord('id1'))
      chain.append(createRecord('id2'))

      const exported = chain.export()
      expect(exported).toHaveLength(2)
      expect(exported[0]!.id).toBe('id1')
      expect(exported[1]!.id).toBe('id2')
    })

    it('returns defensive copy', () => {
      chain.append(createRecord('test'))

      const exported1 = chain.export()
      const exported2 = chain.export()

      expect(exported1).not.toBe(exported2)
      expect(exported1).toEqual(exported2)
    })

    it('includes hash and previousHash', () => {
      chain.append(createRecord('test'))

      const exported = chain.export()
      expect(exported[0]!.hash).toHaveLength(64)
      expect(exported[0]!.previousHash).toBe(GENESIS_HASH)
    })
  })

  describe('hash consistency', () => {
    it('generates same hash for identical records', () => {
      const record: NeutralizationRecord = {
        id: 'fixed-id',
        signature: 'fixed-sig',
        hash: 'fixed-hash',
        size: 100,
        status: 'neutralized',
        timestamp: 12345,
        previousHash: GENESIS_HASH,
      }

      const chain1 = new AuditChain()
      chain1.append(record)

      const chain2 = new AuditChain()
      chain2.append({ ...record })

      expect(chain1.lastHash).toBe(chain2.lastHash)
    })

    it('generates different hash for different records', () => {
      const chain1 = new AuditChain()
      chain1.append(createRecord('id1', { timestamp: 12345 }))

      const chain2 = new AuditChain()
      chain2.append(createRecord('id2', { timestamp: 12345 }))

      expect(chain1.lastHash).not.toBe(chain2.lastHash)
    })
  })

  describe('chain linking', () => {
    it('each record links to previous', () => {
      chain.append(createRecord('1'))
      chain.append(createRecord('2'))
      chain.append(createRecord('3'))

      const exported = chain.export()

      expect(exported[0]!.previousHash).toBe(GENESIS_HASH)
      expect(exported[1]!.previousHash).toBe(exported[0]!.hash)
      expect(exported[2]!.previousHash).toBe(exported[1]!.hash)
    })
  })
})
