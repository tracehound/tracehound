/**
 * Binary Codec tests.
 */

import { describe, expect, it } from 'vitest'
import { createColdPathCodec, createHotPathCodec, GzipCodec } from '../src/utils/binary-codec.js'

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
})
