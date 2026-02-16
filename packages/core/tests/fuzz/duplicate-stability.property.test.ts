import { describe, expect, it } from 'vitest'
import { createTestRuntime, FUZZ_SEED, runDeterministicProperty } from './helpers.js'

describe('Fuzz Invariant: Duplicate Stability', () => {
  it('duplicate signatures never create duplicate quarantine state', () => {
    // eslint-disable-next-line no-console
    console.info(`[fuzz] duplicate-stability seed=${FUZZ_SEED}`)

    runDeterministicProperty('duplicate-stability', (payload, i) => {
      const runtime = createTestRuntime(4_096)

      const first = runtime.agent.intercept({
        id: `dup-${i}-1`,
        payload,
        source: 'duplicate-fuzz',
        timestamp: 1,
        threat: {
          category: 'spam',
          severity: 'low',
        },
      })

      const afterFirst = runtime.quarantine.stats

      const second = runtime.agent.intercept({
        id: `dup-${i}-2`,
        payload,
        source: 'duplicate-fuzz',
        timestamp: 2,
        threat: {
          category: 'spam',
          severity: 'low',
        },
      })

      const afterSecond = runtime.quarantine.stats

      expect(first.status).toBe('quarantined')
      expect(second.status).toBe('ignored')
      expect(afterSecond.count).toBe(afterFirst.count)
      expect(afterSecond.bytes).toBe(afterFirst.bytes)
    })
  })
})
