/**
 * Payload encoding tests with edge case coverage.
 */

import { describe, expect, it } from 'vitest'
import { encodePayload, estimatePayloadSize } from '../src/utils/encode.js'

describe('encodePayload', () => {
  describe('basic functionality', () => {
    it('encodes simple object to UTF-8 bytes', () => {
      const result = encodePayload({ a: 1 }, 1000)

      expect(result.bytes).toBeInstanceOf(Uint8Array)
      expect(result.size).toBeGreaterThan(0)
      expect(result.canonical).toBe('{"a":1}')
    })

    it('returns correct byte size for ASCII', () => {
      const result = encodePayload({ test: 'hello' }, 1000)
      // {"test":"hello"} = 16 bytes
      expect(result.size).toBe(16)
    })

    it('handles unicode correctly (multi-byte)', () => {
      const result = encodePayload({ text: '日本語' }, 1000)
      // UTF-8: 日本語 = 9 bytes (3 bytes each)
      expect(result.size).toBeGreaterThan(result.canonical.length)
    })

    it('produces deterministic output for same payload', () => {
      const r1 = encodePayload({ a: 1, b: 2 }, 1000)
      const r2 = encodePayload({ b: 2, a: 1 }, 1000)

      expect(r1.canonical).toBe(r2.canonical)
      expect(r1.size).toBe(r2.size)
    })
  })

  describe('size validation', () => {
    it('throws for payload exceeding maxSize', () => {
      expect(() => {
        encodePayload({ data: 'x'.repeat(1000) }, 100)
      }).toThrow('exceeds limit')
    })

    it('accepts payload at exactly maxSize', () => {
      const payload = { a: 1 }
      const result = encodePayload(payload, 7) // {"a":1} = 7 bytes
      expect(result.size).toBe(7)
    })

    it('checks byte size not string length', () => {
      // Unicode character takes more bytes than string length
      const payload = { text: '日' } // 日 = 3 bytes in UTF-8
      expect(() => {
        encodePayload(payload, 10) // {"text":"日"} needs more than 10 bytes
      }).toThrow('exceeds limit')
    })
  })

  describe('edge case validation - SECURITY CRITICAL', () => {
    it('rejects undefined values in object', () => {
      const payload = { a: 1, b: undefined }
      expect(() => encodePayload(payload as any, 1000)).toThrow('undefined')
    })

    it('rejects NaN values', () => {
      const payload = { value: NaN }
      expect(() => encodePayload(payload as any, 1000)).toThrow('NaN')
    })

    it('rejects Infinity values', () => {
      const payload = { value: Infinity }
      expect(() => encodePayload(payload as any, 1000)).toThrow('Infinity')
    })

    it('rejects negative Infinity', () => {
      const payload = { value: -Infinity }
      expect(() => encodePayload(payload as any, 1000)).toThrow('Infinity')
    })

    it('rejects functions', () => {
      const payload = { fn: () => {} }
      expect(() => encodePayload(payload as any, 1000)).toThrow('function')
    })

    it('rejects symbols', () => {
      const payload = { sym: Symbol('test') }
      expect(() => encodePayload(payload as any, 1000)).toThrow('symbol')
    })

    it('rejects bigint', () => {
      const payload = { big: BigInt(123) }
      expect(() => encodePayload(payload as any, 1000)).toThrow('bigint')
    })

    it('rejects nested undefined', () => {
      const payload = { outer: { inner: undefined } }
      expect(() => encodePayload(payload as any, 1000)).toThrow('undefined')
    })

    it('rejects undefined in arrays', () => {
      const payload = { arr: [1, undefined, 3] }
      expect(() => encodePayload(payload as any, 1000)).toThrow('undefined')
    })
  })

  describe('valid edge cases', () => {
    it('accepts null values', () => {
      const result = encodePayload({ a: null }, 1000)
      expect(result.canonical).toBe('{"a":null}')
    })

    it('accepts empty object', () => {
      const result = encodePayload({}, 1000)
      expect(result.canonical).toBe('{}')
    })

    it('accepts empty array', () => {
      const result = encodePayload([], 1000)
      expect(result.canonical).toBe('[]')
    })

    it('accepts nested objects', () => {
      const result = encodePayload({ a: { b: { c: 1 } } }, 1000)
      expect(result.canonical).toBe('{"a":{"b":{"c":1}}}')
    })

    it('accepts arrays with objects', () => {
      const result = encodePayload([{ a: 1 }, { b: 2 }], 1000)
      expect(result.canonical).toBe('[{"a":1},{"b":2}]')
    })

    it('accepts boolean values', () => {
      const result = encodePayload({ yes: true, no: false }, 1000)
      expect(result.canonical).toBe('{"no":false,"yes":true}')
    })

    it('accepts number zero', () => {
      const result = encodePayload({ zero: 0 }, 1000)
      expect(result.canonical).toBe('{"zero":0}')
    })

    it('accepts empty string', () => {
      const result = encodePayload({ empty: '' }, 1000)
      expect(result.canonical).toBe('{"empty":""}')
    })
  })
})

describe('estimatePayloadSize', () => {
  it('returns conservative estimate', () => {
    const payload = { test: 'hello' }
    const estimate = estimatePayloadSize(payload)
    const actual = encodePayload(payload, 10000).size

    // Estimate should be >= actual for ASCII
    expect(estimate).toBeGreaterThanOrEqual(actual)
  })

  it('handles unicode conservatively', () => {
    const payload = { text: '日本語テスト' }
    const estimate = estimatePayloadSize(payload)
    const actual = encodePayload(payload, 10000).size

    // Estimate should be >= actual for unicode
    expect(estimate).toBeGreaterThanOrEqual(actual)
  })
})
