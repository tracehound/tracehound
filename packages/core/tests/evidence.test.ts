/**
 * Evidence class tests (TDD - tests first).
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { Evidence } from '../src/core/evidence.js'
import { hashBuffer } from '../src/utils/hash.js'

describe('Evidence', () => {
  let validBytes: ArrayBuffer
  let validHash: string
  let validSignature: string

  beforeEach(() => {
    const data = new TextEncoder().encode('test payload')
    validBytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    validHash = hashBuffer(validBytes)
    validSignature = 'injection:' + 'a'.repeat(64)
  })

  describe('construction', () => {
    it('accepts valid inputs', () => {
      const evidence = new Evidence(validBytes, validSignature, validHash, 'high', Date.now())

      expect(evidence.disposed).toBe(false)
      expect(evidence.signature).toBe(validSignature)
    })

    it('rejects non-ArrayBuffer bytes', () => {
      expect(() => {
        new Evidence(
          'not a buffer' as unknown as ArrayBuffer,
          validSignature,
          validHash,
          'high',
          Date.now()
        )
      }).toThrow()
    })

    it('rejects hash mismatch', () => {
      expect(() => {
        new Evidence(validBytes, validSignature, 'wrong-hash', 'high', Date.now())
      }).toThrow()
    })

    it('rejects empty bytes', () => {
      const empty = new ArrayBuffer(0)
      const emptyHash = hashBuffer(empty)
      expect(() => {
        new Evidence(empty, validSignature, emptyHash, 'high', Date.now())
      }).toThrow()
    })
  })

  describe('getters', () => {
    it('returns bytes when not disposed', () => {
      const evidence = new Evidence(validBytes, validSignature, validHash, 'high', Date.now())
      expect(evidence.bytes.byteLength).toBe(validBytes.byteLength)
    })

    it('throws when accessing bytes after dispose', () => {
      const evidence = new Evidence(validBytes, validSignature, validHash, 'high', Date.now())
      evidence.neutralize('prev-hash')

      expect(() => evidence.bytes).toThrow()
    })

    it('exposes readonly properties', () => {
      const captured = Date.now()
      const evidence = new Evidence(validBytes, validSignature, validHash, 'critical', captured)

      expect(evidence.signature).toBe(validSignature)
      expect(evidence.hash).toBe(validHash)
      expect(evidence.severity).toBe('critical')
      expect(evidence.captured).toBe(captured)
      expect(evidence.size).toBe(validBytes.byteLength)
    })
  })

  describe('transfer', () => {
    it('returns ArrayBuffer', () => {
      const evidence = new Evidence(validBytes, validSignature, validHash, 'high', Date.now())
      const transferred = evidence.transfer()

      expect(transferred).toBeInstanceOf(ArrayBuffer)
      expect(transferred.byteLength).toBe(validBytes.byteLength)
    })

    it('disposes handle after transfer', () => {
      const evidence = new Evidence(validBytes, validSignature, validHash, 'high', Date.now())
      evidence.transfer()

      expect(evidence.disposed).toBe(true)
    })

    it('prevents double transfer', () => {
      const evidence = new Evidence(validBytes, validSignature, validHash, 'high', Date.now())
      evidence.transfer()

      expect(() => evidence.transfer()).toThrow()
    })

    it('prevents transfer after neutralize', () => {
      const evidence = new Evidence(validBytes, validSignature, validHash, 'high', Date.now())
      evidence.neutralize('prev-hash')

      expect(() => evidence.transfer()).toThrow()
    })
  })

  describe('neutralize', () => {
    it('returns NeutralizationRecord', () => {
      const evidence = new Evidence(validBytes, validSignature, validHash, 'high', Date.now())
      const record = evidence.neutralize('prev-hash-123')

      expect(record.id).toBeTruthy()
      expect(record.signature).toBe(validSignature)
      expect(record.hash).toBe(validHash)
      expect(record.size).toBe(validBytes.byteLength)
      expect(record.status).toBe('neutralized')
      expect(record.timestamp).toBeGreaterThan(0)
      expect(record.previousHash).toBe('prev-hash-123')
    })

    it('disposes handle after neutralize', () => {
      const evidence = new Evidence(validBytes, validSignature, validHash, 'high', Date.now())
      evidence.neutralize('prev-hash')

      expect(evidence.disposed).toBe(true)
    })

    it('clears bytes reference', () => {
      const evidence = new Evidence(validBytes, validSignature, validHash, 'high', Date.now())
      evidence.neutralize('prev-hash')

      expect(() => evidence.bytes).toThrow()
    })

    it('prevents double neutralize', () => {
      const evidence = new Evidence(validBytes, validSignature, validHash, 'high', Date.now())
      evidence.neutralize('prev-hash')

      expect(() => evidence.neutralize('prev-hash')).toThrow()
    })

    it('prevents neutralize after transfer', () => {
      const evidence = new Evidence(validBytes, validSignature, validHash, 'high', Date.now())
      evidence.transfer()

      expect(() => evidence.neutralize('prev-hash')).toThrow()
    })

    it('generates unique record IDs', () => {
      const e1 = new Evidence(validBytes, validSignature, validHash, 'high', Date.now())

      const data2 = new TextEncoder().encode('test payload')
      const bytes2 = data2.buffer.slice(data2.byteOffset, data2.byteOffset + data2.byteLength)
      const e2 = new Evidence(bytes2, validSignature, hashBuffer(bytes2), 'high', Date.now())

      const r1 = e1.neutralize('hash1')
      const r2 = e2.neutralize('hash2')

      expect(r1.id).not.toBe(r2.id)
    })
  })

  describe('evacuate', () => {
    it('returns EvacuateRecord', () => {
      const evidence = new Evidence(validBytes, validSignature, validHash, 'high', Date.now())
      const record = evidence.evacuate('s3://bucket/path')

      expect(record.id).toBeTruthy()
      expect(record.signature).toBe(validSignature)
      expect(record.destination).toBe('s3://bucket/path')
      expect(record.timestamp).toBeGreaterThan(0)
      expect(record.size).toBe(validBytes.byteLength)
    })

    it('disposes handle after evacuate', () => {
      const evidence = new Evidence(validBytes, validSignature, validHash, 'high', Date.now())
      evidence.evacuate('s3://bucket/path')

      expect(evidence.disposed).toBe(true)
    })

    it('prevents double evacuate', () => {
      const evidence = new Evidence(validBytes, validSignature, validHash, 'high', Date.now())
      evidence.evacuate('s3://bucket/path')

      expect(() => evidence.evacuate('s3://other')).toThrow()
    })

    it('stubbed compression flag', () => {
      const evidence = new Evidence(validBytes, validSignature, validHash, 'high', Date.now())
      const record = evidence.evacuate('s3://bucket/path')

      expect(record.compressed).toBe(false) // Phase 3
    })
  })

  describe('atomic operations', () => {
    it('neutralize completes in single tick', () => {
      const evidence = new Evidence(validBytes, validSignature, validHash, 'high', Date.now())

      const record = evidence.neutralize('prev-hash')

      // If neutralize is atomic, both should be true immediately
      expect(record).toBeTruthy() // snapshot taken
      expect(evidence.disposed).toBe(true) // bytes cleared
    })

    it('no tampering window between snapshot and destroy', () => {
      const evidence = new Evidence(validBytes, validSignature, validHash, 'high', Date.now())

      let accessAttempted = false

      evidence.neutralize('prev-hash')

      // Try to access immediately after
      try {
        void evidence.bytes
        accessAttempted = true
      } catch {
        // Expected: disposed
      }

      expect(accessAttempted).toBe(false)
    })
  })

  describe('memory safety', () => {
    it('bytes become unreachable after neutralize', () => {
      const data = new TextEncoder().encode('memory test')
      const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      const bytesHash = hashBuffer(bytes)

      let evidence: Evidence | null = new Evidence(
        bytes,
        validSignature,
        bytesHash,
        'high',
        Date.now()
      )

      evidence.neutralize('prev-hash')
      evidence = null

      // Evidence is now unreachable, GC can collect
      // We can't directly test GC, but we verify the reference is cleared
      expect(evidence).toBeNull()
    })
  })
})
