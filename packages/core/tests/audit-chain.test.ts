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
      const exported = chain.export()

      expect(chain.length).toBe(1)
      expect(chain.lastHash).not.toBe(GENESIS_HASH)
      expect(exported[0]!.batchRoot).toHaveLength(64)
    })

    it('chains multiple records', () => {
      chain.append(createRecord('1'))
      chain.append(createRecord('2'))
      chain.append(createRecord('3'))
      const exported = chain.export()

      expect(chain.length).toBe(3)
      expect(new Set(exported.map((record) => record.batchId)).size).toBe(1)
      expect(new Set(exported.map((record) => record.hash)).size).toBe(1)
    })

    it('updates lastHash after each append', () => {
      const before = chain.lastHash
      chain.append(createRecord('test'))
      chain.flushPending()
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
      chain1.flushPending()

      const chain2 = new AuditChain()
      chain2.append({ ...record })
      chain2.flushPending()

      expect(chain1.lastHash).toBe(chain2.lastHash)
    })

    it('generates different hash for different records', () => {
      const chain1 = new AuditChain()
      chain1.append(createRecord('id1', { timestamp: 12345 }))
      chain1.flushPending()

      const chain2 = new AuditChain()
      chain2.append(createRecord('id2', { timestamp: 12345 }))
      chain2.flushPending()

      expect(chain1.lastHash).not.toBe(chain2.lastHash)
    })
  })

  describe('chain linking', () => {
    it('each record links to previous', () => {
      chain.append(createRecord('1'))
      chain.flushPending()
      chain.append(createRecord('2'))
      chain.flushPending()
      chain.append(createRecord('3'))

      const exported = chain.export()

      expect(exported[0]!.previousHash).toBe(GENESIS_HASH)
      expect(exported[1]!.previousHash).toBe(exported[0]!.hash)
      expect(exported[2]!.previousHash).toBe(exported[1]!.hash)
    })
  })

  describe('HMAC mode', () => {
    it('produces different hashes than non-HMAC mode', () => {
      const record = createRecord('hmac-test', { timestamp: 99999 })

      const plain = new AuditChain()
      plain.append(record)
      plain.flushPending()

      const hmac = new AuditChain('my-secret-hmac-key')
      hmac.append({ ...record })
      hmac.flushPending()

      expect(plain.lastHash).not.toBe(hmac.lastHash)
    })

    it('verifies chain with HMAC secret', () => {
      const hmac = new AuditChain('secret-key-for-hmac')
      hmac.append(createRecord('h1'))
      hmac.append(createRecord('h2'))
      hmac.append(createRecord('h3'))

      expect(hmac.verify()).toBe(true)
    })

    it('different secrets produce different hashes', () => {
      const record = createRecord('s-test', { timestamp: 11111 })

      const chain1 = new AuditChain('secret-a')
      chain1.append(record)
      chain1.flushPending()

      const chain2 = new AuditChain('secret-b')
      chain2.append({ ...record })
      chain2.flushPending()

      expect(chain1.lastHash).not.toBe(chain2.lastHash)
    })
  })
})
