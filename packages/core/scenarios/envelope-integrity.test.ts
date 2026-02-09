/**
 * Binary Envelope Integrity Scenario
 *
 * Tests the THCS binary envelope format under adversarial conditions:
 * 1. Header corruption (magic, version, size fields)
 * 2. Truncated data (partial reads from storage)
 * 3. Bit-flip attacks (single bit corruption in compressed data)
 * 4. Size field overflow / mismatch
 * 5. Hash field corruption
 * 6. Zero-length and maximum-length payloads
 * 7. Pack/unpack determinism across multiple invocations
 *
 * These tests validate that the envelope rejects ALL invalid data
 * and never returns corrupted EncodedPayload.
 */

import { describe, expect, it } from 'vitest'
import { packEnvelope, unpackEnvelope, HEADER_SIZE } from '../src/core/s3-cold-storage.js'
import {
  encodeWithIntegrity,
  encodeWithIntegrityAsync,
  verify,
  decodeWithIntegrity,
  decodeWithIntegrityAsync,
} from '../src/utils/binary-codec.js'

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function createValidEnvelope(content: string): Uint8Array {
  const payload = new TextEncoder().encode(content)
  const encoded = encodeWithIntegrity(payload)
  return packEnvelope(encoded)
}

function flipBit(data: Uint8Array, byteIndex: number, bitIndex: number): Uint8Array {
  const copy = new Uint8Array(data)
  copy[byteIndex] = copy[byteIndex]! ^ (1 << bitIndex)
  return copy
}

// ──────────────────────────────────────────────────────────────────────────────
// Header Corruption
// ──────────────────────────────────────────────────────────────────────────────

describe('Envelope Header Corruption', () => {
  it('should reject envelope with wrong magic bytes', () => {
    const valid = createValidEnvelope('test data')

    // Corrupt each magic byte individually
    for (let i = 0; i < 4; i++) {
      const corrupted = new Uint8Array(valid)
      corrupted[i] = 0xFF
      expect(unpackEnvelope(corrupted)).toBeNull()
    }
  })

  it('should reject envelope with all-zero magic', () => {
    const valid = createValidEnvelope('test data')
    const corrupted = new Uint8Array(valid)
    corrupted[0] = 0
    corrupted[1] = 0
    corrupted[2] = 0
    corrupted[3] = 0
    expect(unpackEnvelope(corrupted)).toBeNull()
  })

  it('should reject envelope with wrong version', () => {
    const valid = createValidEnvelope('test data')
    const corrupted = new Uint8Array(valid)
    const view = new DataView(corrupted.buffer)

    // Set version to 0
    view.setUint16(4, 0, false)
    expect(unpackEnvelope(corrupted)).toBeNull()

    // Set version to 2
    view.setUint16(4, 2, false)
    expect(unpackEnvelope(corrupted)).toBeNull()

    // Set version to max
    view.setUint16(4, 0xFFFF, false)
    expect(unpackEnvelope(corrupted)).toBeNull()
  })

  it('should reject envelope with corrupted compressedSize field', () => {
    const valid = createValidEnvelope('test data for size check')
    const corrupted = new Uint8Array(valid)
    const view = new DataView(corrupted.buffer)

    // Make compressedSize claim more data than exists
    const realCompressedSize = view.getUint32(10, false)
    view.setUint32(10, realCompressedSize + 100, false)
    expect(unpackEnvelope(corrupted)).toBeNull()

    // Make compressedSize claim less data than exists
    view.setUint32(10, realCompressedSize - 1, false)
    expect(unpackEnvelope(corrupted)).toBeNull()

    // Zero compressedSize
    view.setUint32(10, 0, false)
    expect(unpackEnvelope(corrupted)).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Truncated Data
// ──────────────────────────────────────────────────────────────────────────────

describe('Envelope Truncated Data', () => {
  it('should reject data shorter than header', () => {
    expect(unpackEnvelope(new Uint8Array(0))).toBeNull()
    expect(unpackEnvelope(new Uint8Array(10))).toBeNull()
    expect(unpackEnvelope(new Uint8Array(HEADER_SIZE - 1))).toBeNull()
  })

  it('should reject header-only data (no compressed payload)', () => {
    const valid = createValidEnvelope('test')
    // Truncate to just header
    const headerOnly = valid.slice(0, HEADER_SIZE)
    // compressedSize in header > 0, but no data follows
    expect(unpackEnvelope(headerOnly)).toBeNull()
  })

  it('should reject data truncated mid-payload', () => {
    const valid = createValidEnvelope('substantial test data with enough content to truncate')
    // Cut off last 10 bytes
    const truncated = valid.slice(0, valid.length - 10)
    expect(unpackEnvelope(truncated)).toBeNull()
  })

  it('should reject data with extra trailing bytes', () => {
    const valid = createValidEnvelope('test')
    // Add extra bytes
    const extended = new Uint8Array(valid.length + 5)
    extended.set(valid)
    extended.set([0xFF, 0xFF, 0xFF, 0xFF, 0xFF], valid.length)
    // compressedSize won't match: header says N bytes but actual is N+5
    expect(unpackEnvelope(extended)).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Bit-Flip Attacks
// ──────────────────────────────────────────────────────────────────────────────

describe('Envelope Bit-Flip Attacks', () => {
  it('should detect bit-flip in compressed data via verify()', () => {
    const original = new TextEncoder().encode('bit flip target evidence')
    const encoded = encodeWithIntegrity(original)
    const envelope = packEnvelope(encoded)

    // Flip a bit in the compressed data region
    const bitFlipped = flipBit(envelope, HEADER_SIZE + 5, 3)

    const unpacked = unpackEnvelope(bitFlipped)
    // unpackEnvelope may succeed (structure is valid, sizes match)
    // BUT verify() MUST catch the corruption
    if (unpacked !== null) {
      expect(verify(unpacked)).toBe(false)
    }
  })

  it('should detect bit-flip in hash field via verify()', () => {
    const original = new TextEncoder().encode('hash corruption test')
    const encoded = encodeWithIntegrity(original)
    const envelope = packEnvelope(encoded)

    // Flip a bit in the hash region (offset 14-77)
    const bitFlipped = flipBit(envelope, 20, 0)

    const unpacked = unpackEnvelope(bitFlipped)
    if (unpacked !== null) {
      expect(verify(unpacked)).toBe(false)
    }
  })

  it('should detect single bit-flip in every byte of compressed data', () => {
    const original = new TextEncoder().encode('exhaustive bit-flip check')
    const encoded = encodeWithIntegrity(original)
    const envelope = packEnvelope(encoded)

    // Test flip in every byte of the compressed region
    for (let i = HEADER_SIZE; i < envelope.length; i++) {
      const flipped = flipBit(envelope, i, 0)
      const unpacked = unpackEnvelope(flipped)

      // If unpack succeeds (structure still valid), verify MUST fail
      if (unpacked !== null) {
        expect(verify(unpacked)).toBe(false)
      }
    }
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Size Boundary Conditions
// ──────────────────────────────────────────────────────────────────────────────

describe('Envelope Size Boundaries', () => {
  it('should handle empty payload (originalSize = 0)', () => {
    const empty = new Uint8Array(0)
    const encoded = encodeWithIntegrity(empty)
    const envelope = packEnvelope(encoded)

    const unpacked = unpackEnvelope(envelope)
    expect(unpacked).not.toBeNull()
    expect(unpacked!.originalSize).toBe(0)
    expect(unpacked!.compressedSize).toBeGreaterThan(0) // gzip header
    expect(verify(unpacked!)).toBe(true)

    const decoded = decodeWithIntegrity(unpacked!)
    expect(decoded.length).toBe(0)
  })

  it('should handle 1-byte payload', () => {
    const single = new Uint8Array([0x42])
    const encoded = encodeWithIntegrity(single)
    const envelope = packEnvelope(encoded)

    const unpacked = unpackEnvelope(envelope)
    expect(unpacked).not.toBeNull()
    expect(unpacked!.originalSize).toBe(1)
    expect(verify(unpacked!)).toBe(true)

    const decoded = decodeWithIntegrity(unpacked!)
    expect(decoded).toEqual(single)
  })

  it('should handle 100KB payload', () => {
    const large = new Uint8Array(100_000)
    for (let i = 0; i < large.length; i++) {
      large[i] = i % 256
    }

    const encoded = encodeWithIntegrity(large)
    const envelope = packEnvelope(encoded)

    const unpacked = unpackEnvelope(envelope)
    expect(unpacked).not.toBeNull()
    expect(unpacked!.originalSize).toBe(100_000)
    expect(verify(unpacked!)).toBe(true)

    const decoded = decodeWithIntegrity(unpacked!)
    expect(decoded).toEqual(large)
  })

  it('should handle incompressible data (random bytes)', () => {
    // Random data doesn't compress — tests the case where
    // compressedSize may be >= originalSize
    const random = new Uint8Array(500)
    for (let i = 0; i < random.length; i++) {
      random[i] = Math.floor(Math.random() * 256)
    }

    const encoded = encodeWithIntegrity(random)
    const envelope = packEnvelope(encoded)

    const unpacked = unpackEnvelope(envelope)
    expect(unpacked).not.toBeNull()
    expect(verify(unpacked!)).toBe(true)

    const decoded = decodeWithIntegrity(unpacked!)
    expect(decoded).toEqual(random)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Pack/Unpack Determinism
// ──────────────────────────────────────────────────────────────────────────────

describe('Envelope Determinism', () => {
  it('should produce identical envelopes for identical payloads', () => {
    const payload = new TextEncoder().encode('determinism check')
    const encoded = encodeWithIntegrity(payload)

    const envelope1 = packEnvelope(encoded)
    const envelope2 = packEnvelope(encoded)

    expect(envelope1).toEqual(envelope2)
  })

  it('should unpack to identical EncodedPayload on repeated unpacking', () => {
    const envelope = createValidEnvelope('repeated unpack test')

    const unpacked1 = unpackEnvelope(envelope)
    const unpacked2 = unpackEnvelope(envelope)

    expect(unpacked1).not.toBeNull()
    expect(unpacked2).not.toBeNull()
    expect(unpacked1!.compressed).toEqual(unpacked2!.compressed)
    expect(unpacked1!.hash).toBe(unpacked2!.hash)
    expect(unpacked1!.originalSize).toBe(unpacked2!.originalSize)
    expect(unpacked1!.compressedSize).toBe(unpacked2!.compressedSize)
  })

  it('should produce identical sync and async envelopes', async () => {
    const payload = new TextEncoder().encode('sync-async envelope match')

    const syncEncoded = encodeWithIntegrity(payload)
    const asyncEncoded = await encodeWithIntegrityAsync(payload)

    const syncEnvelope = packEnvelope(syncEncoded)
    const asyncEnvelope = packEnvelope(asyncEncoded)

    expect(syncEnvelope).toEqual(asyncEnvelope)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Cross-Codec Envelope Interop
// ──────────────────────────────────────────────────────────────────────────────

describe('Envelope Cross-Codec Interop', () => {
  it('should sync-encode → pack → unpack → async-decode', async () => {
    const original = new TextEncoder().encode('sync to async through envelope')

    const encoded = encodeWithIntegrity(original)
    const envelope = packEnvelope(encoded)
    const unpacked = unpackEnvelope(envelope)

    expect(unpacked).not.toBeNull()
    expect(verify(unpacked!)).toBe(true)

    const decoded = await decodeWithIntegrityAsync(unpacked!)
    expect(decoded).toEqual(original)
  })

  it('should async-encode → pack → unpack → sync-decode', async () => {
    const original = new TextEncoder().encode('async to sync through envelope')

    const encoded = await encodeWithIntegrityAsync(original)
    const envelope = packEnvelope(encoded)
    const unpacked = unpackEnvelope(envelope)

    expect(unpacked).not.toBeNull()
    expect(verify(unpacked!)).toBe(true)

    const decoded = decodeWithIntegrity(unpacked!)
    expect(decoded).toEqual(original)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Malicious / Adversarial Inputs
// ──────────────────────────────────────────────────────────────────────────────

describe('Envelope Adversarial Inputs', () => {
  it('should reject envelope that claims zero compressedSize but has data', () => {
    const valid = createValidEnvelope('adversarial test')
    const corrupted = new Uint8Array(valid)
    const view = new DataView(corrupted.buffer)

    // Claim compressedSize = 0 but data follows
    view.setUint32(10, 0, false)

    expect(unpackEnvelope(corrupted)).toBeNull()
  })

  it('should reject all-zeros buffer', () => {
    expect(unpackEnvelope(new Uint8Array(200))).toBeNull()
  })

  it('should reject all-0xFF buffer', () => {
    expect(unpackEnvelope(new Uint8Array(200).fill(0xFF))).toBeNull()
  })

  it('should reject valid magic + version but impossible sizes', () => {
    const buf = new Uint8Array(HEADER_SIZE)
    const view = new DataView(buf.buffer)

    // Set valid magic
    buf.set([0x54, 0x48, 0x43, 0x53], 0)
    // Valid version
    view.setUint16(4, 1, false)
    // Claim massive sizes
    view.setUint32(6, 0xFFFFFFFF, false)
    view.setUint32(10, 0xFFFFFFFF, false)

    // compressedSize says 4GB but buffer is only 78 bytes
    expect(unpackEnvelope(buf)).toBeNull()
  })

  it('should not modify the original envelope buffer during unpack', () => {
    const valid = createValidEnvelope('immutability check')
    const copy = new Uint8Array(valid)

    unpackEnvelope(valid)

    // Original buffer must be unchanged
    expect(valid).toEqual(copy)
  })
})
