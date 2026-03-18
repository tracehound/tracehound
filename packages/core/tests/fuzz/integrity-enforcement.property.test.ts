import { describe, expect, it } from 'vitest'
import type { JsonSerializable } from '../../src/types/common.js'
import { compareSignatures, generateSignature } from '../../src/types/signature.js'
import { FUZZ_SEED, runDeterministicProperty } from './helpers.js'

describe('Fuzz Invariant: Integrity Enforcement', () => {
  it('mutation between sign and verify is always detected', () => {
    // eslint-disable-next-line no-console
    console.info(`[fuzz] integrity-enforcement seed=${FUZZ_SEED}`)

    runDeterministicProperty('integrity-enforcement', (payload, i) => {
      const baseThreat = {
        category: 'injection' as const,
        severity: 'high' as const,
        scent: {
          id: `integrity-${i}`,
          source: { ip: 'fuzz' },
          timestamp: 1,
          payload,
        },
      }

      const originalSignature = generateSignature(baseThreat)

      const mutatedSignature = generateSignature({
        ...baseThreat,
        scent: {
          ...baseThreat.scent,
          payload: {
            original: payload as JsonSerializable,
            mutationTag: `mutation-${i}`,
          },
        },
      })

      expect(compareSignatures(originalSignature, mutatedSignature)).toBe(false)
    })
  })
})
