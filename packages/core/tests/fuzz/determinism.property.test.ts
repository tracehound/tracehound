import { describe, expect, it } from 'vitest'
import { generateSignature } from '../../src/types/signature.js'
import { encodePayload } from '../../src/utils/encode.js'
import { buildThreat, FUZZ_SEED, runDeterministicProperty } from './helpers.js'

describe('Fuzz Invariant: Determinism', () => {
  it('identical input produces identical canonical/hash/signature output', () => {
    // eslint-disable-next-line no-console
    console.info(`[fuzz] determinism seed=${FUZZ_SEED}`)

    runDeterministicProperty('determinism', (payload, i) => {
      const threat = buildThreat(Math.abs(i))

      const threatInput = {
        category: threat.category,
        severity: threat.severity,
        scent: {
          id: 'determinism-a',
          source: 'fuzz',
          timestamp: 1,
          payload,
        },
      }

      const sigA = generateSignature(threatInput)
      const sigB = generateSignature({
        ...threatInput,
        scent: {
          ...threatInput.scent,
          id: 'determinism-b',
          timestamp: 2,
        },
      })

      const encodedA = encodePayload(payload as never, 1_000_000)
      const encodedB = encodePayload(payload as never, 1_000_000)

      expect(encodedA.canonical).toBe(encodedB.canonical)
      expect(Array.from(encodedA.bytes)).toEqual(Array.from(encodedB.bytes))
      expect(sigA).toBe(sigB)
    })
  })
})
