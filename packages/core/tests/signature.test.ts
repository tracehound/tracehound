/**
 * Signature generation and validation tests.
 */

import { describe, expect, it } from 'vitest'
import type { JsonSerializable } from '../src/types/common.js'
import type { Scent } from '../src/types/scent.js'
import { generateSignature, validateSignature } from '../src/types/signature.js'
import type { ThreatInput } from '../src/types/threat.js'

function createScent(payload: JsonSerializable): Scent {
  return {
    id: 'test-id',
    payload,
    source: '127.0.0.1',
    timestamp: Date.now(),
  }
}

function createThreat(category: ThreatInput['category'], payload: JsonSerializable): ThreatInput {
  return {
    category,
    severity: 'high',
    scent: createScent(payload),
  }
}

describe('generateSignature', () => {
  it('generates deterministic hash for same payload with different key order', () => {
    const t1 = createThreat('injection', { x: 1, y: 2 })
    const t2 = createThreat('injection', { y: 2, x: 1 })
    expect(generateSignature(t1)).toBe(generateSignature(t2))
  })

  it('generates different hash for different payload', () => {
    const t1 = createThreat('injection', { x: 1 })
    const t2 = createThreat('injection', { x: 2 })
    expect(generateSignature(t1)).not.toBe(generateSignature(t2))
  })

  it('generates different hash for different category', () => {
    const payload = { x: 1 }
    const t1 = createThreat('injection', payload)
    const t2 = createThreat('ddos', payload)
    expect(generateSignature(t1)).not.toBe(generateSignature(t2))
  })

  it('handles nested objects deterministically', () => {
    const t1 = createThreat('injection', { outer: { a: 1, b: 2 }, c: 3 })
    const t2 = createThreat('injection', { c: 3, outer: { b: 2, a: 1 } })
    expect(generateSignature(t1)).toBe(generateSignature(t2))
  })

  it('handles arrays correctly', () => {
    const t1 = createThreat('injection', { arr: [1, 2, 3] })
    const t2 = createThreat('injection', { arr: [1, 2, 3] })
    expect(generateSignature(t1)).toBe(generateSignature(t2))
  })

  it('treats different array order as different', () => {
    const t1 = createThreat('injection', { arr: [1, 2, 3] })
    const t2 = createThreat('injection', { arr: [3, 2, 1] })
    expect(generateSignature(t1)).not.toBe(generateSignature(t2))
  })

  it('generates valid signature format', () => {
    const threat = createThreat('injection', { test: 'data' })
    const sig = generateSignature(threat)
    expect(sig).toMatch(/^injection:[a-f0-9]{64}$/)
  })
})

describe('validateSignature', () => {
  it('accepts valid signature', () => {
    const validSig = 'injection:' + 'a'.repeat(64)
    expect(validateSignature(validSig)).toBe(true)
  })

  it('accepts signature with different category', () => {
    const sig = 'sql-injection:' + 'b'.repeat(64)
    expect(validateSignature(sig)).toBe(true)
  })

  it('rejects signature without colon', () => {
    expect(validateSignature('invalid')).toBe(false)
  })

  it('rejects signature with empty category', () => {
    expect(validateSignature(':' + 'a'.repeat(64))).toBe(false)
  })

  it('rejects signature with short hash', () => {
    expect(validateSignature('category:short')).toBe(false)
  })

  it('rejects signature with invalid hash characters', () => {
    expect(validateSignature('category:' + 'g'.repeat(64))).toBe(false)
  })

  it('rejects signature with too long hash', () => {
    expect(validateSignature('category:' + 'a'.repeat(65))).toBe(false)
  })
})
