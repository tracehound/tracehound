/**
 * Async Codec tests.
 *
 * Verifies non-blocking gzip encode/decode for cold storage operations.
 * Async codec MUST produce identical output to sync codec (determinism).
 */

import { describe, expect, it } from 'vitest'
import {
  AsyncGzipCodec,
  CodecError,
  createAsyncColdPathCodec,
  decodeWithIntegrity,
  decodeWithIntegrityAsync,
  encodeWithIntegrity,
  encodeWithIntegrityAsync,
  verify,
} from '../src/utils/binary-codec.js'

describe('AsyncCodec', () => {
  describe('AsyncGzipCodec', () => {
    it('async encode produces valid compressed output', async () => {
      const codec = new AsyncGzipCodec()
      const original = new Uint8Array(1000).fill(65) // 1000 'A's

      const encoded = await codec.encode(original)

      expect(encoded).toBeInstanceOf(Uint8Array)
      expect(encoded.length).toBeLessThan(original.length)
    })

    it('async decode reverses async encode', async () => {
      const codec = new AsyncGzipCodec()
      const original = new TextEncoder().encode('Hello, Tracehound Async!')

      const encoded = await codec.encode(original)
      const decoded = await codec.decode(encoded)

      expect(decoded).toEqual(original)
    })

    it('tracks statistics', async () => {
      const codec = new AsyncGzipCodec()
      const data = new Uint8Array(100).fill(66)

      await codec.encode(data)
      await codec.encode(data)

      expect(codec.stats.encodeCount).toBe(2)
      expect(codec.stats.totalInputBytes).toBe(200)
    })

    it('stats are immutable snapshots', async () => {
      const codec = new AsyncGzipCodec()
      const data = new Uint8Array(50).fill(67)

      await codec.encode(data)
      const stats1 = codec.stats

      await codec.encode(data)
      const stats2 = codec.stats

      expect(stats1.encodeCount).toBe(1)
      expect(stats2.encodeCount).toBe(2)
    })

    it('handles empty bytes', async () => {
      const codec = new AsyncGzipCodec()
      const empty = new Uint8Array(0)

      const encoded = await codec.encode(empty)
      const decoded = await codec.decode(encoded)

      expect(decoded.length).toBe(0)
    })

    it('handles JSON payload', async () => {
      const codec = new AsyncGzipCodec()
      const payload = { attack: 'sql injection', data: 'x'.repeat(500) }
      const original = new TextEncoder().encode(JSON.stringify(payload))

      const encoded = await codec.encode(original)
      const decoded = await codec.decode(encoded)

      expect(decoded).toEqual(original)
      expect(encoded.length).toBeLessThan(original.length)
    })

    it('async output is byte-identical to sync output (determinism)', async () => {
      const asyncCodec = new AsyncGzipCodec()
      const { GzipCodec } = await import('../src/utils/binary-codec.js')
      const syncCodec = new GzipCodec()

      const data = new TextEncoder().encode('deterministic test payload')

      const asyncResult = await asyncCodec.encode(data)
      const syncResult = syncCodec.encode(data)

      expect(asyncResult).toEqual(syncResult)
    })
  })

  describe('createAsyncColdPathCodec', () => {
    it('returns codec with async encode and decode', () => {
      const codec = createAsyncColdPathCodec()

      expect(typeof codec.encode).toBe('function')
      expect(typeof codec.decode).toBe('function')
    })

    it('async roundtrip works', async () => {
      const codec = createAsyncColdPathCodec()
      const original = new TextEncoder().encode('cold storage async data')

      const encoded = await codec.encode(original)
      const decoded = await codec.decode(encoded)

      expect(decoded).toEqual(original)
    })
  })

  // ============================================================================
  // ASYNC COLD STORAGE INTEGRITY TESTS
  // ============================================================================

  describe('encodeWithIntegrityAsync()', () => {
    it('should async compress and hash payload', async () => {
      const payload = new TextEncoder().encode('Async integrity test!')
      const encoded = await encodeWithIntegrityAsync(payload)

      expect(encoded.originalSize).toBe(payload.length)
      expect(encoded.compressedSize).toBeGreaterThan(0)
      expect(encoded.hash).toHaveLength(64) // SHA-256 hex
      expect(encoded.compressed).toBeInstanceOf(Uint8Array)
    })

    it('should handle empty payload (valid per policy)', async () => {
      const payload = new Uint8Array(0)
      const encoded = await encodeWithIntegrityAsync(payload)

      expect(encoded.originalSize).toBe(0)
      expect(encoded.compressedSize).toBeGreaterThan(0) // gzip header
      expect(encoded.hash).toHaveLength(64)
    })

    it('should produce identical output to sync version (determinism)', async () => {
      const payload = new TextEncoder().encode('determinism check')

      const syncEncoded = encodeWithIntegrity(payload)
      const asyncEncoded = await encodeWithIntegrityAsync(payload)

      expect(asyncEncoded.compressed).toEqual(syncEncoded.compressed)
      expect(asyncEncoded.hash).toBe(syncEncoded.hash)
      expect(asyncEncoded.originalSize).toBe(syncEncoded.originalSize)
      expect(asyncEncoded.compressedSize).toBe(syncEncoded.compressedSize)
    })

    it('verify() works on async-encoded payload', async () => {
      const payload = new TextEncoder().encode('verify async')
      const encoded = await encodeWithIntegrityAsync(payload)

      expect(verify(encoded)).toBe(true)
    })
  })

  describe('decodeWithIntegrityAsync()', () => {
    it('should async round-trip encode/decode', async () => {
      const original = new TextEncoder().encode('Async round trip!')
      const encoded = await encodeWithIntegrityAsync(original)
      const decoded = await decodeWithIntegrityAsync(encoded)

      expect(decoded).toEqual(original)
    })

    it('should async decode sync-encoded payload (interop)', async () => {
      const original = new TextEncoder().encode('sync-to-async interop')
      const syncEncoded = encodeWithIntegrity(original)
      const asyncDecoded = await decodeWithIntegrityAsync(syncEncoded)

      expect(asyncDecoded).toEqual(original)
    })

    it('sync decode works on async-encoded payload (interop)', async () => {
      const original = new TextEncoder().encode('async-to-sync interop')
      const asyncEncoded = await encodeWithIntegrityAsync(original)
      const syncDecoded = decodeWithIntegrity(asyncEncoded)

      expect(syncDecoded).toEqual(original)
    })

    it('should throw CodecError on corrupted data', async () => {
      const payload = new TextEncoder().encode('Corrupt me')
      const encoded = await encodeWithIntegrityAsync(payload)

      const corrupted = {
        ...encoded,
        compressed: new Uint8Array([0x00, 0x01, 0x02]),
      }

      await expect(decodeWithIntegrityAsync(corrupted)).rejects.toThrow(CodecError)
    })

    it('should async handle empty payload round-trip', async () => {
      const original = new Uint8Array(0)
      const encoded = await encodeWithIntegrityAsync(original)
      const decoded = await decodeWithIntegrityAsync(encoded)

      expect(decoded).toEqual(original)
    })
  })

  describe('async verify-before-decode pattern', () => {
    it('should catch tampering before async decode attempt', async () => {
      const payload = new TextEncoder().encode('Sensitive async evidence')
      const encoded = await encodeWithIntegrityAsync(payload)

      const tampered = {
        ...encoded,
        compressed: new Uint8Array([...encoded.compressed].map((b) => b ^ 0x01)),
      }

      // Correct pattern: verify first, then decode only if valid
      expect(verify(tampered)).toBe(false)
    })
  })
})
