/**
 * Constant-time comparison tests.
 */

import { describe, expect, it } from 'vitest'
import { constantTimeBufferEqual, constantTimeEqual } from '../src/utils/compare.js'

describe('constantTimeEqual', () => {
  it('returns true for identical strings', () => {
    expect(constantTimeEqual('hello', 'hello')).toBe(true)
  })

  it('returns false for different strings', () => {
    expect(constantTimeEqual('hello', 'world')).toBe(false)
  })

  it('returns false for different lengths', () => {
    expect(constantTimeEqual('short', 'longer string')).toBe(false)
  })

  it('returns true for empty strings', () => {
    expect(constantTimeEqual('', '')).toBe(true)
  })

  it('handles unicode correctly', () => {
    expect(constantTimeEqual('日本語', '日本語')).toBe(true)
    expect(constantTimeEqual('日本語', '中文')).toBe(false)
  })

  it('handles signature-like strings', () => {
    const sig1 = 'injection:' + 'a'.repeat(64)
    const sig2 = 'injection:' + 'a'.repeat(64)
    const sig3 = 'injection:' + 'b'.repeat(64)

    expect(constantTimeEqual(sig1, sig2)).toBe(true)
    expect(constantTimeEqual(sig1, sig3)).toBe(false)
  })

  it('detects single character difference', () => {
    const a = 'injection:' + 'a'.repeat(63) + 'b'
    const b = 'injection:' + 'a'.repeat(64)

    expect(constantTimeEqual(a, b)).toBe(false)
  })
})

describe('constantTimeBufferEqual', () => {
  it('returns true for identical buffers', () => {
    const a = new Uint8Array([1, 2, 3, 4])
    const b = new Uint8Array([1, 2, 3, 4])

    expect(constantTimeBufferEqual(a, b)).toBe(true)
  })

  it('returns false for different buffers', () => {
    const a = new Uint8Array([1, 2, 3, 4])
    const b = new Uint8Array([1, 2, 3, 5])

    expect(constantTimeBufferEqual(a, b)).toBe(false)
  })

  it('returns false for different lengths', () => {
    const a = new Uint8Array([1, 2, 3])
    const b = new Uint8Array([1, 2, 3, 4])

    expect(constantTimeBufferEqual(a, b)).toBe(false)
  })

  it('handles ArrayBuffer input', () => {
    const a = new ArrayBuffer(4)
    const b = new ArrayBuffer(4)
    new Uint8Array(a).set([1, 2, 3, 4])
    new Uint8Array(b).set([1, 2, 3, 4])

    expect(constantTimeBufferEqual(a, b)).toBe(true)
  })

  it('returns true for empty buffers', () => {
    expect(constantTimeBufferEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true)
  })
})
