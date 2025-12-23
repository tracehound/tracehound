/**
 * Utility function tests.
 */

import { describe, expect, it } from 'vitest'
import { hash, hashBuffer } from '../src/utils/hash.js'
import { generateSecureId, isValidSecureId } from '../src/utils/id.js'
import { serialize } from '../src/utils/serialize.js'

describe('serialize', () => {
  it('produces deterministic output for different key orders', () => {
    expect(serialize({ a: 1, b: 2 })).toBe(serialize({ b: 2, a: 1 }))
  })

  it('handles nested objects deterministically', () => {
    const a = { outer: { inner: 1, other: 2 } }
    const b = { outer: { other: 2, inner: 1 } }
    expect(serialize(a)).toBe(serialize(b))
  })

  it('handles deeply nested objects', () => {
    const a = { l1: { l2: { l3: { a: 1, b: 2 } } } }
    const b = { l1: { l2: { l3: { b: 2, a: 1 } } } }
    expect(serialize(a)).toBe(serialize(b))
  })

  it('preserves array order', () => {
    expect(serialize([1, 2, 3])).not.toBe(serialize([3, 2, 1]))
  })

  it('handles primitives', () => {
    expect(serialize('test')).toBe('"test"')
    expect(serialize(123)).toBe('123')
    expect(serialize(true)).toBe('true')
    expect(serialize(null)).toBe('null')
  })

  it('handles empty objects', () => {
    expect(serialize({})).toBe('{}')
  })

  it('handles empty arrays', () => {
    expect(serialize([])).toBe('[]')
  })
})

describe('hash', () => {
  it('produces consistent output', () => {
    expect(hash('test')).toBe(hash('test'))
  })

  it('produces different output for different input', () => {
    expect(hash('test1')).not.toBe(hash('test2'))
  })

  it('produces 64 character hex string', () => {
    const result = hash('any input')
    expect(result).toMatch(/^[a-f0-9]{64}$/)
  })

  it('produces lowercase hex', () => {
    const result = hash('TEST')
    expect(result).toBe(result.toLowerCase())
  })
})

describe('hashBuffer', () => {
  it('produces consistent output', () => {
    const buffer = new TextEncoder().encode('test')
    expect(hashBuffer(buffer)).toBe(hashBuffer(buffer))
  })

  it('produces same hash as string version for same content', () => {
    const str = 'test'
    const buffer = new TextEncoder().encode(str)
    expect(hashBuffer(buffer)).toBe(hash(str))
  })
})

describe('generateSecureId', () => {
  it('generates unique IDs', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      ids.add(generateSecureId())
    }
    expect(ids.size).toBe(100)
  })

  it('generates IDs with correct length', () => {
    const id = generateSecureId()
    // UUIDv7 (36) + hyphen (1) + suffix (8) = 45
    expect(id.length).toBe(45)
  })

  it('generates valid format', () => {
    const id = generateSecureId()
    expect(isValidSecureId(id)).toBe(true)
  })
})

describe('isValidSecureId', () => {
  it('validates correct format', () => {
    const id = generateSecureId()
    expect(isValidSecureId(id)).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isValidSecureId('')).toBe(false)
  })

  it('rejects standard UUID without suffix', () => {
    expect(isValidSecureId('550e8400-e29b-41d4-a716-446655440000')).toBe(false)
  })

  it('rejects invalid format', () => {
    expect(isValidSecureId('not-a-valid-id')).toBe(false)
  })
})
