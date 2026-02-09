/**
 * Async Codec Stress Scenario
 *
 * Real-world tests for the async codec under production-like conditions:
 * 1. High concurrency (100+ simultaneous encode/decode)
 * 2. Determinism under contention (async interleaving)
 * 3. Stats accuracy with concurrent mutations
 * 4. Mixed sync/async interop under load
 * 5. Large payload handling
 * 6. Memory stability during sustained operations
 */

import { describe, expect, it } from 'vitest'
import {
  AsyncGzipCodec,
  createAsyncColdPathCodec,
  decodeWithIntegrity,
  decodeWithIntegrityAsync,
  encodeWithIntegrity,
  encodeWithIntegrityAsync,
  GzipCodec,
  verify,
} from '../src/utils/binary-codec.js'

describe('Async Codec Stress Scenario', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // Concurrent Encode/Decode
  // ──────────────────────────────────────────────────────────────────────────

  it('should handle 100 concurrent encode operations without data corruption', async () => {
    const codec = new AsyncGzipCodec()
    const syncCodec = new GzipCodec()
    const payloads: Uint8Array[] = []

    // Generate 100 distinct payloads
    for (let i = 0; i < 100; i++) {
      payloads.push(new TextEncoder().encode(`evidence-payload-${i}-${'x'.repeat(200 + i)}`))
    }

    // Fire all 100 encodes simultaneously
    const results = await Promise.all(payloads.map((p) => codec.encode(p)))

    // Every result must match its sync equivalent (determinism proof)
    for (let i = 0; i < 100; i++) {
      const syncResult = syncCodec.encode(payloads[i]!)
      expect(results[i]).toEqual(syncResult)
    }
  })

  it('should handle 100 concurrent round-trips without data loss', async () => {
    const codec = new AsyncGzipCodec()
    const payloads: Uint8Array[] = []

    for (let i = 0; i < 100; i++) {
      const data = JSON.stringify({
        id: `ev-${i}`,
        attack: `payload-${i}`,
        details: 'A'.repeat(500 + (i * 3)),
        timestamp: Date.now() + i,
      })
      payloads.push(new TextEncoder().encode(data))
    }

    // Encode all concurrently
    const encoded = await Promise.all(payloads.map((p) => codec.encode(p)))

    // Decode all concurrently
    const decoded = await Promise.all(encoded.map((e) => codec.decode(e)))

    // Verify every payload survived the round-trip
    for (let i = 0; i < 100; i++) {
      expect(decoded[i]).toEqual(payloads[i])
    }
  })

  it('should maintain accurate stats under concurrent operations', async () => {
    const codec = new AsyncGzipCodec()
    const COUNT = 50
    const payloads: Uint8Array[] = []

    for (let i = 0; i < COUNT; i++) {
      payloads.push(new Uint8Array(100 + i).fill(65 + (i % 26)))
    }

    // Run all encodes concurrently
    await Promise.all(payloads.map((p) => codec.encode(p)))

    const stats = codec.stats

    // Stats must be exact — JS is single-threaded, so counter increments
    // between awaits should be safe, but this verifies it
    expect(stats.encodeCount).toBe(COUNT)
    expect(stats.decodeCount).toBe(0)

    const expectedInputBytes = payloads.reduce((sum, p) => sum + p.length, 0)
    expect(stats.totalInputBytes).toBe(expectedInputBytes)
    expect(stats.totalOutputBytes).toBeGreaterThan(0)
    expect(stats.compressionRatio).toBeGreaterThan(0)
    expect(stats.compressionRatio).toBeLessThan(2) // ratio should be reasonable
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Integrity Under Concurrency
  // ──────────────────────────────────────────────────────────────────────────

  it('should maintain SHA-256 integrity across 50 concurrent encodeWithIntegrityAsync', async () => {
    const payloads: Uint8Array[] = []

    for (let i = 0; i < 50; i++) {
      payloads.push(new TextEncoder().encode(`integrity-test-${i}-${'Z'.repeat(300)}`))
    }

    // All 50 async encodes in parallel
    const results = await Promise.all(payloads.map((p) => encodeWithIntegrityAsync(p)))

    // Every result must pass verify()
    for (let i = 0; i < 50; i++) {
      expect(verify(results[i]!)).toBe(true)
      expect(results[i]!.originalSize).toBe(payloads[i]!.length)
    }
  })

  it('should pass verify() after concurrent async encode then concurrent async decode', async () => {
    const originals: Uint8Array[] = []

    for (let i = 0; i < 30; i++) {
      originals.push(new TextEncoder().encode(`round-trip-integrity-${i}-${'Q'.repeat(i * 10)}`))
    }

    // Phase 1: concurrent encode
    const encoded = await Promise.all(originals.map((p) => encodeWithIntegrityAsync(p)))

    // Phase 2: verify all
    for (const e of encoded) {
      expect(verify(e)).toBe(true)
    }

    // Phase 3: concurrent decode
    const decoded = await Promise.all(encoded.map((e) => decodeWithIntegrityAsync(e)))

    // Phase 4: verify data fidelity
    for (let i = 0; i < 30; i++) {
      expect(decoded[i]).toEqual(originals[i])
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Sync/Async Interop Under Load
  // ──────────────────────────────────────────────────────────────────────────

  it('should interop correctly when sync and async codecs are used together', async () => {
    const payload = new TextEncoder().encode('interop-stress-payload-' + 'X'.repeat(1000))

    // Encode sync, decode async (50 times concurrently)
    const syncEncoded = encodeWithIntegrity(payload)
    const asyncDecodes = await Promise.all(
      Array.from({ length: 50 }, () => decodeWithIntegrityAsync(syncEncoded))
    )

    for (const decoded of asyncDecodes) {
      expect(decoded).toEqual(payload)
    }

    // Encode async, decode sync (50 times)
    const asyncEncoded = await encodeWithIntegrityAsync(payload)
    for (let i = 0; i < 50; i++) {
      const syncDecoded = decodeWithIntegrity(asyncEncoded)
      expect(syncDecoded).toEqual(payload)
    }
  })

  it('should handle mixed concurrent sync and async encodes producing identical results', async () => {
    const payloads: Uint8Array[] = []
    for (let i = 0; i < 20; i++) {
      payloads.push(new TextEncoder().encode(`mixed-${i}-${'M'.repeat(100 + i)}`))
    }

    // Run sync and async in "parallel" (async fires, sync blocks during await gaps)
    const asyncResults = await Promise.all(
      payloads.map((p) => encodeWithIntegrityAsync(p))
    )

    const syncResults = payloads.map((p) => encodeWithIntegrity(p))

    // Must be byte-identical
    for (let i = 0; i < 20; i++) {
      expect(asyncResults[i]!.compressed).toEqual(syncResults[i]!.compressed)
      expect(asyncResults[i]!.hash).toBe(syncResults[i]!.hash)
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Large Payload
  // ──────────────────────────────────────────────────────────────────────────

  it('should handle 1MB payload encode/decode without corruption', async () => {
    // 1MB of structured data (not just repeated bytes — less compressible)
    const parts: string[] = []
    for (let i = 0; i < 10000; i++) {
      parts.push(`{"id":${i},"ts":${Date.now()},"data":"${Math.random().toString(36)}"}`)
    }
    const payload = new TextEncoder().encode(parts.join('\n'))
    expect(payload.length).toBeGreaterThan(500_000)

    const encoded = await encodeWithIntegrityAsync(payload)
    expect(verify(encoded)).toBe(true)

    const decoded = await decodeWithIntegrityAsync(encoded)
    expect(decoded).toEqual(payload)
  })

  it('should handle 5 concurrent 500KB payloads', async () => {
    const payloads: Uint8Array[] = []
    for (let i = 0; i < 5; i++) {
      const data = JSON.stringify({
        batch: i,
        entries: Array.from({ length: 5000 }, (_, j) => ({
          id: j,
          value: Math.random().toString(36).repeat(5),
        })),
      })
      payloads.push(new TextEncoder().encode(data))
    }

    // Verify each is substantial
    for (const p of payloads) {
      expect(p.length).toBeGreaterThan(400_000)
    }

    // Concurrent encode
    const encoded = await Promise.all(payloads.map((p) => encodeWithIntegrityAsync(p)))

    // All pass integrity
    for (const e of encoded) {
      expect(verify(e)).toBe(true)
    }

    // Concurrent decode
    const decoded = await Promise.all(encoded.map((e) => decodeWithIntegrityAsync(e)))

    for (let i = 0; i < 5; i++) {
      expect(decoded[i]).toEqual(payloads[i])
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Throughput Benchmark
  // ──────────────────────────────────────────────────────────────────────────

  it('should measure async codec throughput', async () => {
    const payload = new TextEncoder().encode('benchmark-payload-' + 'B'.repeat(500))

    const ITERATIONS = 200

    // Sequential async encode
    const seqStart = performance.now()
    for (let i = 0; i < ITERATIONS; i++) {
      await encodeWithIntegrityAsync(payload)
    }
    const seqTime = performance.now() - seqStart

    // Concurrent async encode (batched)
    const concStart = performance.now()
    await Promise.all(
      Array.from({ length: ITERATIONS }, () => encodeWithIntegrityAsync(payload))
    )
    const concTime = performance.now() - concStart

    console.log(`=== Async Codec Benchmark ===`)
    console.log(`Sequential: ${ITERATIONS} encodes in ${seqTime.toFixed(1)}ms (${(ITERATIONS / seqTime * 1000).toFixed(0)} ops/sec)`)
    console.log(`Concurrent: ${ITERATIONS} encodes in ${concTime.toFixed(1)}ms (${(ITERATIONS / concTime * 1000).toFixed(0)} ops/sec)`)
    console.log(`Speedup: ${(seqTime / concTime).toFixed(2)}x`)
    console.log(`=============================`)

    // Concurrent should be at least as fast as sequential (usually faster due to pipelining)
    // On some CI runners this may not hold, so we just verify both complete without error
    expect(seqTime).toBeGreaterThan(0)
    expect(concTime).toBeGreaterThan(0)
  })
})
