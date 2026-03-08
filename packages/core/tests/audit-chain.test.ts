/**
 * AuditChain tests (TDD).
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { AuditChain, GENESIS_HASH } from '../src/core/audit-chain.js'
import type { AuditRecord } from '../src/types/audit.js'
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

    it('seals pending events before append when the batch window elapses', () => {
      const windowed = new AuditChain({ batchWindowMs: 10 })

      windowed.append(createRecord('first', { timestamp: 1_000 }))
      windowed.append(createRecord('second', { timestamp: 1_010 }))

      const exported = windowed.export()

      expect(exported[0]!.batchId).not.toBe(exported[1]!.batchId)
      expect(exported[1]!.previousHash).toBe(exported[0]!.hash)
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

    it('rejects verification when the retained batch head is missing', () => {
      chain.append(createRecord('missing-head'))
      chain.flushPending()

      const internal = chain as unknown as { records: Array<unknown> }
      internal.records[0] = undefined

      expect(chain.verify()).toBe(false)
    })

    it('rejects verification when batch collection returns no records', () => {
      chain.append(createRecord('empty-batch'))
      chain.flushPending()

      const internal = chain as unknown as {
        collectBatch: (startIndex: number, batchId: string) => []
      }
      internal.collectBatch = () => []

      expect(chain.verify()).toBe(false)
    })

    it('rejects verification when an event hash is tampered', () => {
      chain.append(createRecord('tamper-hash'))
      chain.flushPending()
      const internal = chain as unknown as { records: AuditRecord[] }
      internal.records[0] = {
        ...internal.records[0]!,
        eventHash: 'f'.repeat(64),
      }

      expect(chain.verify()).toBe(false)
    })

    it('rejects verification when a batch root is tampered', () => {
      chain.append(createRecord('tamper-root'))
      chain.flushPending()
      const internal = chain as unknown as { records: AuditRecord[] }
      internal.records[0] = {
        ...internal.records[0]!,
        batchRoot: 'a'.repeat(64),
      }

      expect(chain.verify()).toBe(false)
    })

    it('rejects verification when batch metadata no longer matches the chain hash', () => {
      chain.append(createRecord('tamper-link'))
      chain.flushPending()
      const internal = chain as unknown as { records: AuditRecord[] }
      internal.records[0] = {
        ...internal.records[0]!,
        batchIndex: 9,
      }

      expect(chain.verify()).toBe(false)
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

    it('returns immutable records that cannot mutate chain state', () => {
      chain.append(createRecord('immutable-export'))

      const exported = chain.export()
      const originalEventHash = exported[0]!.eventHash

      expect(Object.isFrozen(exported[0])).toBe(true)

      try {
        exported[0]!.eventHash = 'f'.repeat(64)
      } catch {
        // Assignment can throw in strict mode for frozen records.
      }

      expect(exported[0]!.eventHash).toBe(originalEventHash)
      expect(chain.verify()).toBe(true)
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

  describe('record normalization', () => {
    it('normalizes evacuation, purge, drop, eviction, and decay records', () => {
      const typedChain = new AuditChain({ batchWindowMs: 10.9, maxRecords: 5.9 })

      typedChain.append({
        id: 'evac-1',
        signature: 'sig-evac',
        destination: 's3://archive/path',
        timestamp: 1_000,
        compressed: true,
        size: 42,
      })
      typedChain.append({
        id: 'purge-1',
        signature: 'sig-purge',
        hash: 'hash-purge',
        size: 10,
        status: 'purged',
        reason: 'panic',
        scent: {
          id: 'scent-purge',
          source: { ip: '10.0.0.1' },
          timestamp: 1_011,
          payloadHash: 'payload-hash',
          payloadSize: 10,
        },
        timestamp: 1_011,
        previousHash: GENESIS_HASH,
      })
      typedChain.append({
        id: 'drop-1',
        signature: 'sig-drop',
        hash: 'hash-drop',
        size: 11,
        status: 'dropped',
        reason: 'capacity',
        timestamp: 1_022,
        previousHash: GENESIS_HASH,
      })
      typedChain.append({
        id: 'eviction-1',
        signature: 'sig-eviction',
        hash: 'hash-eviction',
        size: 12,
        status: 'evicted',
        reason: 'capacity',
        timestamp: 1_033,
        previousHash: GENESIS_HASH,
      })
      typedChain.append({
        id: 'decay-1',
        signature: 'sig-decay',
        hash: 'hash-decay',
        size: 13,
        status: 'decayed',
        reason: 'ttl_expired',
        timestamp: 1_044,
        previousHash: GENESIS_HASH,
        archived: false,
        storageError: 'cold storage unavailable',
      })

      const exported = typedChain.export()

      expect(exported.map((record) => record.type)).toEqual([
        'evacuation',
        'purge',
        'drop',
        'eviction',
        'decay',
      ])
    })

    it('rotates retained records using the floored maxRecords value', () => {
      const bounded = new AuditChain({ batchWindowMs: 1, maxRecords: 2.9 })

      bounded.append(createRecord('1', { timestamp: 100 }))
      bounded.flushPending()
      bounded.append(createRecord('2', { timestamp: 101 }))
      bounded.flushPending()
      bounded.append(createRecord('3', { timestamp: 102 }))
      bounded.flushPending()

      const exported = bounded.export()

      expect(exported).toHaveLength(2)
      expect(exported[0]!.id).toBe('2')
      expect(exported[1]!.id).toBe('3')
    })

    it('evicts whole batches from the front to preserve retained Merkle integrity', () => {
      const bounded = new AuditChain({ batchWindowMs: 10, maxRecords: 2, maxBatchSize: 2 })

      bounded.append(createRecord('batch-a-1', { timestamp: 1_000 }))
      bounded.append(createRecord('batch-a-2', { timestamp: 1_001 }))
      bounded.append(createRecord('batch-a-3', { timestamp: 1_002 }))
      bounded.append(createRecord('batch-b-1', { timestamp: 1_020 }))
      bounded.flushPending()

      const exported = bounded.export()

      expect(exported).toHaveLength(2)
      expect(exported[0]!.id).toBe('batch-a-3')
      expect(exported[1]!.id).toBe('batch-b-1')
      expect(exported[0]!.batchIndex).toBe(0)
      expect(exported[1]!.batchIndex).toBe(0)
      expect(bounded.verify()).toBe(true)
    })

    it('keeps retained records within maxRecords under sustained same-window appends', () => {
      const bounded = new AuditChain({ batchWindowMs: 10, maxRecords: 2 })

      bounded.append(createRecord('latest-1', { timestamp: 2_000 }))
      bounded.append(createRecord('latest-2', { timestamp: 2_001 }))
      bounded.append(createRecord('latest-3', { timestamp: 2_002 }))
      bounded.flushPending()

      const exported = bounded.export()

      expect(exported.length).toBeLessThanOrEqual(2)
      expect(bounded.verify()).toBe(true)
    })
  })
})
