import { describe, expect, it } from 'vitest'
import { createTestRuntime, FUZZ_SEED, runDeterministicProperty } from './helpers.js'

function buildThreatScent(id: string, payload: unknown, timestamp: number) {
  return {
    id,
    source: { ip: 'state-machine-fuzz' },
    timestamp,
    payload,
    threat: {
      category: 'injection' as const,
      severity: 'high' as const,
    },
  }
}

describe('Fuzz Phase 4: State Machine Adversarial Testing', () => {
  it('append permutation preserves deterministic convergence', () => {
    // eslint-disable-next-line no-console
    console.info(`[fuzz] state-machine permutation seed=${FUZZ_SEED}`)

    runDeterministicProperty(
      'state-machine-permutation',
      (candidate, i) => {
        const runtimeA = createTestRuntime(2048)
        const runtimeB = createTestRuntime(2048)

        const payloads = [
          { a: candidate, tag: 'A' },
          { a: candidate, tag: 'B' },
          { a: candidate, tag: 'A' }, // duplicate
        ]

        const signaturesA = new Set<string>()
        for (let idx = 0; idx < payloads.length; idx++) {
          const result = runtimeA.agent.intercept(
            buildThreatScent(`a-${i}-${idx}`, payloads[idx], idx + 1),
          )
          if (result.status === 'quarantined') {
            signaturesA.add(result.handle.signature)
          }
          if (result.status === 'ignored') {
            signaturesA.add(result.signature)
          }
        }

        const signaturesB = new Set<string>()
        for (let idx = payloads.length - 1; idx >= 0; idx--) {
          const result = runtimeB.agent.intercept(
            buildThreatScent(`b-${i}-${idx}`, payloads[idx], idx + 1),
          )
          if (result.status === 'quarantined') {
            signaturesB.add(result.handle.signature)
          }
          if (result.status === 'ignored') {
            signaturesB.add(result.signature)
          }
        }

        expect(Array.from(signaturesA).sort()).toEqual(Array.from(signaturesB).sort())
        expect(runtimeA.quarantine.stats.count).toBe(runtimeB.quarantine.stats.count)
      },
      { runs: 80 },
    )
  })

  it('partial failure ordering does not cause state drift', () => {
    // eslint-disable-next-line no-console
    console.info(`[fuzz] state-machine partial-failure seed=${FUZZ_SEED}`)

    runDeterministicProperty(
      'state-machine-partial-failure',
      (candidate, i) => {
        const runtime = createTestRuntime(128)

        const accepted = runtime.agent.intercept(buildThreatScent(`ok-${i}`, { ok: 'stable' }, 1))
        const beforeFailure = runtime.quarantine.stats

        const rejected = runtime.agent.intercept(
          buildThreatScent(
            `oversized-${i}`,
            { huge: `${JSON.stringify(candidate)}-${'Z'.repeat(1024)}` },
            2,
          ),
        )
        const afterFailure = runtime.quarantine.stats

        expect(accepted.status).toBe('quarantined')
        expect(rejected.status).toBe('payload_too_large')
        expect(afterFailure.count).toBe(beforeFailure.count)
        expect(afterFailure.bytes).toBe(beforeFailure.bytes)
      },
      { runs: 60 },
    )
  })

  it('duplicate replay under rapid ordering remains stable', () => {
    // eslint-disable-next-line no-console
    console.info(`[fuzz] state-machine duplicate-replay seed=${FUZZ_SEED}`)

    runDeterministicProperty(
      'state-machine-duplicate-replay',
      (candidate, i) => {
        const runtime = createTestRuntime(4096)

        const payload = { replay: candidate, marker: i % 5 }
        const first = runtime.agent.intercept(buildThreatScent(`dup-first-${i}`, payload, 1))
        const second = runtime.agent.intercept(buildThreatScent(`dup-second-${i}`, payload, 2))
        const third = runtime.agent.intercept(buildThreatScent(`dup-third-${i}`, payload, 3))

        expect(first.status).toBe('quarantined')
        expect(second.status).toBe('ignored')
        expect(third.status).toBe('ignored')
        expect(runtime.quarantine.stats.count).toBe(1)
      },
      { runs: 80 },
    )
  })
})
