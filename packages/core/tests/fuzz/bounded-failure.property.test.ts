import { describe, expect, it } from 'vitest'
import { createTestRuntime, FUZZ_SEED, runDeterministicProperty } from './helpers.js'

describe('Fuzz Invariant: Bounded Failure + State Non-Amplification', () => {
  it('oversized malformed inputs are rejected without mutating quarantine state', () => {
    // eslint-disable-next-line no-console
    console.info(`[fuzz] bounded-failure seed=${FUZZ_SEED}`)

    runDeterministicProperty(
      'bounded-failure',
      (candidate, i) => {
        const oversizedBody = `${JSON.stringify(candidate)}-${'X'.repeat(400)}`

        const runtime = createTestRuntime(256)
        const before = runtime.quarantine.stats

        const result = runtime.agent.intercept({
          id: `oversized-${i}`,
          payload: { blob: oversizedBody },
          source: { ip: 'fuzz-source' },
          timestamp: 1,
          threat: {
            category: 'flood',
            severity: 'high',
          },
        })

        const after = runtime.quarantine.stats

        expect(result.status).toBe('payload_too_large')
        expect(after.count).toBe(before.count)
        expect(after.bytes).toBe(before.bytes)
      },
      { runs: 80 },
    )
  })
})
