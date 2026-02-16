import { describe, expect, it } from 'vitest'
import { encodePayload } from '../../src/utils/encode.js'
import { FUZZ_SEED, runDeterministicProperty } from './helpers.js'

describe('Fuzz Invariant: Canonical Idempotency', () => {
  it('canonical(canonical(x)) equals canonical(x)', () => {
    // eslint-disable-next-line no-console
    console.info(`[fuzz] canonical-idempotency seed=${FUZZ_SEED}`)

    runDeterministicProperty('canonical-idempotency', (payload) => {
      const encoded = encodePayload(payload as never, 1_000_000)
      const parsedCanonical = JSON.parse(encoded.canonical)
      const recanonicalized = encodePayload(parsedCanonical, 1_000_000)

      expect(recanonicalized.canonical).toBe(encoded.canonical)
      expect(recanonicalized.size).toBe(encoded.size)
    })
  })
})
