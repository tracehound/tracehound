/**
 * Binary Codec tests.
 */

import { describe, expect, it } from 'vitest'
import {
  CodecError,
  createAsyncColdPathCodec,
  createColdPathCodec,
  createHotPathCodec,
  decodeWithIntegrity,
  decodeWithIntegrityAsync,
  encodeWithIntegrity,
  encodeWithIntegrityAsync,
  GzipCodec,
  verify,
} from '../src/utils/binary-codec.js'

describe('BinaryCodec', () => {
  describe('GzipCodec', () => {
    it('encodes bytes to smaller size', () => {
      const codec = new GzipCodec()
      // Repetitive data compresses well
      const original = new Uint8Array(1000).fill(65) // 1000 'A's

      const encoded = codec.encode(original)

      expect(encoded.length).toBeLessThan(original.length)
    })

    it('decode reverses encode', () => {
      const codec = new GzipCodec()
      const original = new TextEncoder().encode('Hello, Tracehound!')

      const encoded = codec.encode(original)
      const decoded = codec.decode(encoded)

      expect(decoded).toEqual(original)
    })

    it('tracks statistics', () => {
      const codec = new GzipCodec()
      const data = new Uint8Array(100).fill(66)

      codec.encode(data)
      codec.encode(data)

      expect(codec.stats.encodeCount).toBe(2)
      expect(codec.stats.totalInputBytes).toBe(200)
    })

    it('stats are immutable snapshots', () => {
      const codec = new GzipCodec()
      const data = new Uint8Array(50).fill(67)

      codec.encode(data)
      const stats1 = codec.stats

      codec.encode(data)
      const stats2 = codec.stats

      // Different snapshots
      expect(stats1.encodeCount).toBe(1)
      expect(stats2.encodeCount).toBe(2)
    })

    it('handles empty bytes', () => {
      const codec = new GzipCodec()
      const empty = new Uint8Array(0)

      const encoded = codec.encode(empty)
      const decoded = codec.decode(encoded)

      expect(decoded.length).toBe(0)
    })

    it('handles JSON payload', () => {
      const codec = new GzipCodec()
      const payload = { attack: 'sql injection', data: 'x'.repeat(500) }
      const original = new TextEncoder().encode(JSON.stringify(payload))

      const encoded = codec.encode(original)
      const decoded = codec.decode(encoded)

      expect(decoded).toEqual(original)
      expect(encoded.length).toBeLessThan(original.length)
    })
  })

  describe('createHotPathCodec', () => {
    it('returns codec with encode only', () => {
      const codec = createHotPathCodec()

      // Has encode
      expect(typeof codec.encode).toBe('function')

      // Does NOT have decode (type-level enforcement)
      expect((codec as any).decode).toBeUndefined()
    })

    it('encode works correctly', () => {
      const codec = createHotPathCodec()
      const original = new TextEncoder().encode('test data')

      const encoded = codec.encode(original)

      expect(encoded).toBeInstanceOf(Uint8Array)
      expect(encoded.length).toBeGreaterThan(0)
    })
  })

  describe('createColdPathCodec', () => {
    it('returns codec with encode and decode', () => {
      const codec = createColdPathCodec()

      expect(typeof codec.encode).toBe('function')
      expect(typeof codec.decode).toBe('function')
    })

    it('roundtrip works', () => {
      const codec = createColdPathCodec()
      const original = new TextEncoder().encode('cold storage data')

      const encoded = codec.encode(original)
      const decoded = codec.decode(encoded)

      expect(decoded).toEqual(original)
    })
  })

  describe('Security Invariants', () => {
    it('HotPathCodec has no decode access at runtime', () => {
      const hotCodec = createHotPathCodec()

      // Runtime check - decode should not exist
      expect('decode' in hotCodec).toBe(false)
    })

    it('compression is deterministic', () => {
      const codec = new GzipCodec()
      const data = new TextEncoder().encode('deterministic test')

      const encoded1 = codec.encode(data)
      const encoded2 = codec.encode(data)

      // Gzip with same input produces same output
      expect(encoded1).toEqual(encoded2)
    })
  })

  describe('AsyncGzipCodec', () => {
    it('roundtrip works asynchronously', async () => {
      const codec = createAsyncColdPathCodec()
      const original = new TextEncoder().encode('async test data')

      const encoded = await codec.encode(original)
      const decoded = await codec.decode(encoded)

      expect(decoded).toEqual(original)
    })

    it('tracks stats asynchronously', async () => {
      const codec = createAsyncColdPathCodec()
      const data = new Uint8Array(20).fill(1)

      await codec.encode(data)
      expect((codec as any).stats.encodeCount).toBe(1)
      expect((codec as any).stats.totalInputBytes).toBe(20)
    })
  })

  // ============================================================================
  // COLD STORAGE INTEGRITY TESTS
  // ============================================================================

  describe('encodeWithIntegrity()', () => {
    it('should compress and hash payload', () => {
      const payload = new TextEncoder().encode('Hello, Tracehound!')
      const encoded = encodeWithIntegrity(payload)

      expect(encoded.originalSize).toBe(payload.length)
      expect(encoded.compressedSize).toBeGreaterThan(0)
      expect(encoded.hash).toHaveLength(64) // SHA-256 hex
      expect(encoded.compressed).toBeInstanceOf(Uint8Array)
    })

    it('should handle empty payload (valid per policy)', () => {
      const payload = new Uint8Array(0)
      const encoded = encodeWithIntegrity(payload)

      expect(encoded.originalSize).toBe(0)
      expect(encoded.compressedSize).toBeGreaterThan(0) // gzip header
      expect(encoded.hash).toHaveLength(64)
    })

    it('should produce smaller output for compressible data', () => {
      // Highly compressible: repeated pattern
      const payload = new TextEncoder().encode('A'.repeat(10000))
      const encoded = encodeWithIntegrity(payload)

      expect(encoded.compressedSize).toBeLessThan(encoded.originalSize)
    })
  })

  describe('verify()', () => {
    it('should return true for untampered payload', () => {
      const payload = new TextEncoder().encode('Test data')
      const encoded = encodeWithIntegrity(payload)

      expect(verify(encoded)).toBe(true)
    })

    it('should return false for tampered hash', () => {
      const payload = new TextEncoder().encode('Test data')
      const encoded = encodeWithIntegrity(payload)

      const tampered = {
        ...encoded,
        hash: 'a'.repeat(64), // Wrong hash
      }

      expect(verify(tampered)).toBe(false)
    })

    it('should return false for tampered compressed data', () => {
      const payload = new TextEncoder().encode('Test data')
      const encoded = encodeWithIntegrity(payload)

      // Flip a byte
      const tamperedCompressed = new Uint8Array(encoded.compressed)
      tamperedCompressed[10] ^= 0xff

      const tampered = {
        ...encoded,
        compressed: tamperedCompressed,
      }

      expect(verify(tampered)).toBe(false)
    })
  })

  describe('decodeWithIntegrity()', () => {
    it('should round-trip encode/decode', () => {
      const original = new TextEncoder().encode('Round trip test!')
      const encoded = encodeWithIntegrity(original)
      const decoded = decodeWithIntegrity(encoded)

      expect(decoded).toEqual(original)
    })

    it('should round-trip empty payload', () => {
      const original = new Uint8Array(0)
      const encoded = encodeWithIntegrity(original)
      const decoded = decodeWithIntegrity(encoded)

      expect(decoded).toEqual(original)
    })

    it('should throw CodecError on corrupted data', () => {
      const payload = new TextEncoder().encode('Test')
      const encoded = encodeWithIntegrity(payload)

      // Corrupt the compressed data
      const corrupted = {
        ...encoded,
        compressed: new Uint8Array([0x00, 0x01, 0x02]),
      }

      expect(() => decodeWithIntegrity(corrupted)).toThrow(CodecError)
    })
  })

  describe('verify-before-decode pattern', () => {
    it('should catch tampering before decode attempt', () => {
      const payload = new TextEncoder().encode('Sensitive evidence')
      const encoded = encodeWithIntegrity(payload)

      // Tamper in transit
      const tampered = {
        ...encoded,
        compressed: new Uint8Array([...encoded.compressed].map((b) => b ^ 0x01)),
      }

      // Correct pattern: verify first
      if (verify(tampered)) {
        expect.fail('Should have detected tampering')
      } else {
        // Tampering detected without wasting decode CPU
        expect(true).toBe(true)
      }
    })
  })

  describe('encodeWithIntegrityAsync()', () => {
    it('should round-trip encode/decode asynchronously', async () => {
      const original = new TextEncoder().encode('async integrity test')
      const encoded = await encodeWithIntegrityAsync(original)
      const decoded = await decodeWithIntegrityAsync(encoded)

      expect(decoded).toEqual(original)
    })

    it('should throw CodecError on compression failure', async () => {
      // We can trigger this by passing something that isn't a Uint8Array
      // but TypeScript might complain. However, at runtime zlib will fail.
      await expect(encodeWithIntegrityAsync(null as any)).rejects.toThrow(CodecError)
    })
  })

  describe('decodeWithIntegrityAsync()', () => {
    it('should throw CodecError on decompression failure', async () => {
      const corrupted = {
        compressed: new Uint8Array([1, 2, 3]),
        hash: 'fake',
        originalSize: 10,
        compressedSize: 3,
      }

      await expect(decodeWithIntegrityAsync(corrupted)).rejects.toThrow(CodecError)
    })
  })
})
