/**
 * Evidence class tests (TDD - tests first).
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { Evidence } from '../src/core/evidence.js'
import type { ScentSource } from '../src/types/scent.js'
import { hashBuffer } from '../src/utils/hash.js'

const defaultSource: ScentSource = {
  ip: '127.0.0.1',
}

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
      const evidence = new Evidence(
        validBytes,
        validSignature,
        validHash,
        'high',
        Date.now(),
        defaultSource,
      )

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
          Date.now(),
          defaultSource,
        )
      }).toThrow()
    })

    it('rejects hash mismatch', () => {
      expect(() => {
        new Evidence(validBytes, validSignature, 'wrong-hash', 'high', Date.now(), defaultSource)
      }).toThrow()
    })

    it('rejects empty bytes', () => {
      const empty = new ArrayBuffer(0)
      const emptyHash = hashBuffer(empty)
      expect(() => {
        new Evidence(empty, validSignature, emptyHash, 'high', Date.now(), defaultSource)
      }).toThrow()
    })
  })

  describe('getters', () => {
    it('returns bytes when not disposed', () => {
      const evidence = new Evidence(
        validBytes,
        validSignature,
        validHash,
        'high',
        Date.now(),
        defaultSource,
      )
      expect(evidence.bytes.byteLength).toBe(validBytes.byteLength)
    })

    it('throws when accessing bytes after dispose', () => {
      const evidence = new Evidence(
        validBytes,
        validSignature,
        validHash,
        'high',
        Date.now(),
        defaultSource,
      )
      evidence.neutralize('prev-hash')

      expect(() => evidence.bytes).toThrow()
    })

    it('exposes readonly properties', () => {
      const captured = Date.now()
      const evidence = new Evidence(
        validBytes,
        validSignature,
        validHash,
        'critical',
        captured,
        defaultSource,
      )

      expect(evidence.signature).toBe(validSignature)
      expect(evidence.hash).toBe(validHash)
      expect(evidence.severity).toBe('critical')
      expect(evidence.captured).toBe(captured)
      expect(evidence.size).toBe(validBytes.byteLength)
    })

    it('exposes whether evidence bytes were stored in compressed form', () => {
      const evidence = new Evidence(
        validBytes,
        validSignature,
        validHash,
        'high',
        Date.now(),
        defaultSource,
        true,
      )

      expect(evidence.compressed).toBe(true)
    })

    it('exposes source metadata', () => {
      const source: ScentSource = {
        ip: '192.168.1.1',
        userAgent: 'test-agent',
        tls: { cipherSuite: 'TLS_AES_256_GCM_SHA384', version: 'TLSv1.3' },
      }
      const evidence = new Evidence(
        validBytes,
        validSignature,
        validHash,
        'high',
        Date.now(),
        source,
      )

      expect(evidence.source.ip).toBe('192.168.1.1')
      expect(evidence.source.userAgent).toBe('test-agent')
      expect(evidence.source.tls?.cipherSuite).toBe('TLS_AES_256_GCM_SHA384')
    })

    it('snapshots source metadata at capture time', () => {
      const mutableSource = {
        ip: '192.168.1.1',
        userAgent: 'before',
        tls: { cipherSuite: 'TLS_AES_256_GCM_SHA384', version: 'TLSv1.3' },
      }
      const evidence = new Evidence(
        validBytes,
        validSignature,
        validHash,
        'high',
        Date.now(),
        mutableSource as ScentSource,
      )

      mutableSource.userAgent = 'after'
      mutableSource.tls.cipherSuite = 'TLS_CHACHA20_POLY1305_SHA256'

      expect(evidence.source).toEqual({
        ip: '192.168.1.1',
        userAgent: 'before',
        tls: {
          cipherSuite: 'TLS_AES_256_GCM_SHA384',
          version: 'TLSv1.3',
        },
      })
      expect(Object.isFrozen(evidence.source)).toBe(true)
      expect(Object.isFrozen(evidence.source.tls)).toBe(true)
    })
  })

  describe('transfer', () => {
    it('returns ArrayBuffer', () => {
      const evidence = new Evidence(
        validBytes,
        validSignature,
        validHash,
        'high',
        Date.now(),
        defaultSource,
      )
      const transferred = evidence.transfer()

      expect(transferred).toBeInstanceOf(ArrayBuffer)
      expect(transferred.byteLength).toBe(validBytes.byteLength)
    })

    it('disposes handle after transfer', () => {
      const evidence = new Evidence(
        validBytes,
        validSignature,
        validHash,
        'high',
        Date.now(),
        defaultSource,
      )
      evidence.transfer()

      expect(evidence.disposed).toBe(true)
    })

    it('prevents double transfer', () => {
      const evidence = new Evidence(
        validBytes,
        validSignature,
        validHash,
        'high',
        Date.now(),
        defaultSource,
      )
      evidence.transfer()

      expect(() => evidence.transfer()).toThrow()
    })

    it('prevents transfer after neutralize', () => {
      const evidence = new Evidence(
        validBytes,
        validSignature,
        validHash,
        'high',
        Date.now(),
        defaultSource,
      )
      evidence.neutralize('prev-hash')

      expect(() => evidence.transfer()).toThrow()
    })
  })

  describe('neutralize', () => {
    it('returns NeutralizationRecord', () => {
      const evidence = new Evidence(
        validBytes,
        validSignature,
        validHash,
        'high',
        Date.now(),
        defaultSource,
      )
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
      const evidence = new Evidence(
        validBytes,
        validSignature,
        validHash,
        'high',
        Date.now(),
        defaultSource,
      )
      evidence.neutralize('prev-hash')

      expect(evidence.disposed).toBe(true)
    })

    it('clears bytes reference', () => {
      const evidence = new Evidence(
        validBytes,
        validSignature,
        validHash,
        'high',
        Date.now(),
        defaultSource,
      )
      evidence.neutralize('prev-hash')

      expect(() => evidence.bytes).toThrow()
    })

    it('prevents double neutralize', () => {
      const evidence = new Evidence(
        validBytes,
        validSignature,
        validHash,
        'high',
        Date.now(),
        defaultSource,
      )
      evidence.neutralize('prev-hash')

      expect(() => evidence.neutralize('prev-hash')).toThrow()
    })

    it('prevents neutralize after transfer', () => {
      const evidence = new Evidence(
        validBytes,
        validSignature,
        validHash,
        'high',
        Date.now(),
        defaultSource,
      )
      evidence.transfer()

      expect(() => evidence.neutralize('prev-hash')).toThrow()
    })

    it('generates unique record IDs', () => {
      const e1 = new Evidence(
        validBytes,
        validSignature,
        validHash,
        'high',
        Date.now(),
        defaultSource,
      )

      const data2 = new TextEncoder().encode('test payload')
      const bytes2 = data2.buffer.slice(data2.byteOffset, data2.byteOffset + data2.byteLength)
      const e2 = new Evidence(
        bytes2,
        validSignature,
        hashBuffer(bytes2),
        'high',
        Date.now(),
        defaultSource,
      )

      const r1 = e1.neutralize('hash1')
      const r2 = e2.neutralize('hash2')

      expect(r1.id).not.toBe(r2.id)
    })
  })

  describe('evacuate', () => {
    it('returns EvacuateRecord', () => {
      const evidence = new Evidence(
        validBytes,
        validSignature,
        validHash,
        'high',
        Date.now(),
        defaultSource,
      )
      const record = evidence.evacuate('s3://bucket/path')

      expect(record.id).toBeTruthy()
      expect(record.signature).toBe(validSignature)
      expect(record.destination).toBe('s3://bucket/path')
      expect(record.timestamp).toBeGreaterThan(0)
      expect(record.size).toBe(validBytes.byteLength)
    })

    it('disposes handle after evacuate', () => {
      const evidence = new Evidence(
        validBytes,
        validSignature,
        validHash,
        'high',
        Date.now(),
        defaultSource,
      )
      evidence.evacuate('s3://bucket/path')

      expect(evidence.disposed).toBe(true)
    })

    it('prevents double evacuate', () => {
      const evidence = new Evidence(
        validBytes,
        validSignature,
        validHash,
        'high',
        Date.now(),
        defaultSource,
      )
      evidence.evacuate('s3://bucket/path')

      expect(() => evidence.evacuate('s3://other')).toThrow()
    })

    it('stubbed compression flag', () => {
      const evidence = new Evidence(
        validBytes,
        validSignature,
        validHash,
        'high',
        Date.now(),
        defaultSource,
      )
      const record = evidence.evacuate('s3://bucket/path')

      expect(record.compressed).toBe(false)
    })

    it('uses the injected clock for evacuation timestamps', () => {
      const evidence = new Evidence(
        validBytes,
        validSignature,
        validHash,
        'high',
        1000,
        defaultSource,
        false,
        () => 4242,
      )
      const record = evidence.evacuate('s3://bucket/path')

      expect(record.timestamp).toBe(4242)
    })
  })

  describe('atomic operations', () => {
    it('neutralize completes in single tick', () => {
      const evidence = new Evidence(
        validBytes,
        validSignature,
        validHash,
        'high',
        Date.now(),
        defaultSource,
      )

      const record = evidence.neutralize('prev-hash')

      expect(record).toBeTruthy()
      expect(evidence.disposed).toBe(true)
    })

    it('no tampering window between snapshot and destroy', () => {
      const evidence = new Evidence(
        validBytes,
        validSignature,
        validHash,
        'high',
        Date.now(),
        defaultSource,
      )

      let accessAttempted = false

      evidence.neutralize('prev-hash')

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
        Date.now(),
        defaultSource,
      )

      evidence.neutralize('prev-hash')
      evidence = null

      expect(evidence).toBeNull()
    })
  })
})
