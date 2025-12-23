/**
 * Evidence Factory with Codec Integration tests.
 */

import { describe, expect, it } from 'vitest'
import { createEvidenceFactory } from '../src/core/evidence-factory.js'
import type { JsonSerializable } from '../src/types/common.js'
import type { Scent } from '../src/types/scent.js'
import { createColdPathCodec, createHotPathCodec } from '../src/utils/binary-codec.js'
import { encodePayload } from '../src/utils/encode.js'

describe('EvidenceFactory with Codec', () => {
  const createScent = (payload: JsonSerializable): Scent => ({
    id: 'test-scent',
    payload,
    source: 'test',
    timestamp: Date.now(),
  })

  describe('Without codec', () => {
    it('evidence is not compressed', () => {
      const factory = createEvidenceFactory()
      const payload = { data: 'x'.repeat(500) }
      const scent = createScent(payload)

      const result = factory.create(scent, { category: 'injection', severity: 'high' }, 1_000_000)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.compressed).toBe(false)
        // Size matches encoded size
        const encoded = encodePayload(payload, 1_000_000)
        expect(result.size).toBe(encoded.size)
      }
    })
  })

  describe('With HotPathCodec', () => {
    it('evidence is compressed', () => {
      const codec = createHotPathCodec()
      const factory = createEvidenceFactory({ codec })
      const payload = { data: 'x'.repeat(500) }
      const scent = createScent(payload)

      const result = factory.create(scent, { category: 'injection', severity: 'high' }, 1_000_000)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.compressed).toBe(true)
        // Compressed size is smaller
        const encoded = encodePayload(payload, 1_000_000)
        expect(result.size).toBeLessThan(encoded.size)
      }
    })

    it('signature is computed BEFORE compression', () => {
      const codec = createHotPathCodec()
      const factoryWithCodec = createEvidenceFactory({ codec })
      const factoryWithoutCodec = createEvidenceFactory()

      const payload = { data: 'consistent hash' }
      const scent = createScent(payload)
      const threat = { category: 'ddos' as const, severity: 'high' as const }

      const resultWithCodec = factoryWithCodec.create(scent, threat, 1_000_000)
      const resultWithoutCodec = factoryWithoutCodec.create(scent, threat, 1_000_000)

      // CRITICAL: Same signature regardless of compression
      expect(resultWithCodec.ok && resultWithoutCodec.ok).toBe(true)
      if (resultWithCodec.ok && resultWithoutCodec.ok) {
        expect(resultWithCodec.signature).toBe(resultWithoutCodec.signature)
        expect(resultWithCodec.hash).toBe(resultWithoutCodec.hash)
      }
    })
  })

  describe('Compressed evidence roundtrip', () => {
    it('can decompress evidence with ColdPathCodec', () => {
      const hotCodec = createHotPathCodec()
      const coldCodec = createColdPathCodec()

      const factory = createEvidenceFactory({ codec: hotCodec })
      const payload = { forensics: 'data', value: 42 }
      const scent = createScent(payload)

      const result = factory.create(scent, { category: 'malware', severity: 'critical' }, 1_000_000)

      expect(result.ok).toBe(true)
      if (result.ok) {
        // Get compressed bytes from evidence
        const compressedBytes = result.evidence.transfer()

        // Decompress using cold codec
        const decompressed = coldCodec.decode(new Uint8Array(compressedBytes))

        // Verify original payload is recoverable
        const recoveredPayload = JSON.parse(new TextDecoder().decode(decompressed))
        expect(recoveredPayload).toEqual(payload)
      }
    })
  })

  describe('Security invariants', () => {
    it('HotPathCodec cannot decode', () => {
      const codec = createHotPathCodec()

      // Type-level: decode does not exist
      expect((codec as any).decode).toBeUndefined()
    })

    it('compression does not change signature determinism', () => {
      const codec = createHotPathCodec()
      const factory = createEvidenceFactory({ codec })

      const payload = { key: 'value', nested: { a: 1, b: 2 } }
      const scent1 = createScent({ nested: { b: 2, a: 1 }, key: 'value' }) // Different order
      const scent2 = createScent(payload)

      const result1 = factory.create(scent1, { category: 'spam', severity: 'low' }, 1_000_000)
      const result2 = factory.create(scent2, { category: 'spam', severity: 'low' }, 1_000_000)

      // Same signature for semantically equal payloads
      expect(result1.ok && result2.ok).toBe(true)
      if (result1.ok && result2.ok) {
        expect(result1.signature).toBe(result2.signature)
      }
    })
  })
})
