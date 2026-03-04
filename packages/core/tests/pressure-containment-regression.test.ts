/**
 * TH-M3-0011-04 regression tests.
 *
 * Locks behavior for:
 * - deterministic Drop and Count under pressure
 * - degraded coordination fail-open intercept continuity
 * - runtime membrane payload egress rejection
 */

import { describe, expect, it } from 'vitest'
import { Agent } from '../src/core/agent.js'
import { AuditChain } from '../src/core/audit-chain.js'
import { createEvidenceFactory } from '../src/core/evidence-factory.js'
import { Quarantine } from '../src/core/quarantine.js'
import { createRateLimiter } from '../src/core/rate-limiter.js'
import type { CoordinationFeature, CoordinationHealth, CoordinationProvider } from '../src/types/coordination.js'
import type { Scent } from '../src/types/scent.js'

function createThreatScent(
  id: string,
  payload: Scent['payload'],
  severity: 'low' | 'medium' | 'high' | 'critical' = 'high',
): Scent {
  return {
    id,
    timestamp: Date.now(),
    source: `regression-${id}`,
    payload,
    threat: { category: 'injection', severity },
  }
}

describe('TH-M3-0011-04 Regression', () => {
  it('increments dropped counters monotonically when overflow is rejected under pressure', () => {
    const quarantine = new Quarantine(
      { maxCount: 1, maxBytes: 1_000_000, evictionPolicy: 'priority' },
      new AuditChain(),
    )
    const agent = new Agent(
      { maxPayloadSize: 1_000_000 },
      quarantine,
      createRateLimiter({ windowMs: 60_000, maxRequests: 100, blockDurationMs: 300_000 }),
      createEvidenceFactory(),
    )

    const anchor = agent.intercept(
      createThreatScent('pressure-anchor', { attack: 'critical-anchor' }, 'critical'),
    )
    expect(anchor.status).toBe('quarantined')

    const before = quarantine.stats.droppedCount
    const firstOverflow = agent.intercept(
      createThreatScent('pressure-overflow-1', { attack: 'low-overflow-1' }, 'low'),
    )
    const afterFirst = quarantine.stats.droppedCount
    const secondOverflow = agent.intercept(
      createThreatScent('pressure-overflow-2', { attack: 'low-overflow-2' }, 'low'),
    )
    const afterSecond = quarantine.stats.droppedCount

    expect(firstOverflow.status).toBe('ignored')
    expect(secondOverflow.status).toBe('ignored')
    expect(afterFirst).toBe(before + 1)
    expect(afterSecond).toBe(afterFirst + 1)
    expect(quarantine.stats.count).toBe(1)
    expect(quarantine.stats.bySeverity.critical).toBe(1)
  })

  it('degrades coordination health safely when provider health throws while keeping intercept operational', () => {
    const provider: CoordinationProvider = {
      providerId: 'regression-throwing-provider',
      features: new Set<CoordinationFeature>(['shared_blocklist']),
      start: async (): Promise<void> => {},
      stop: async (): Promise<void> => {},
      health: (): CoordinationHealth => {
        throw new Error('provider unavailable')
      },
    }

    const quarantine = new Quarantine(
      { maxCount: 10, maxBytes: 1_000_000, evictionPolicy: 'priority' },
      new AuditChain(),
    )
    const agent = new Agent(
      { maxPayloadSize: 1_000_000, coordinationProvider: provider },
      quarantine,
      createRateLimiter({ windowMs: 60_000, maxRequests: 100, blockDurationMs: 300_000 }),
      createEvidenceFactory(),
    )

    const health = agent.getCoordinationHealth()
    const result = agent.intercept(
      createThreatScent('coordination-regression', { attack: 'coordination-fallback' }, 'high'),
    )

    expect(health.mode).toBe('degraded')
    expect(health.provider).toBe('regression-throwing-provider')
    expect(result.status).toBe('quarantined')
    expect(quarantine.stats.count).toBe(1)
  })

  it('blocks runtime payload egress and increments membrane rejection counter', () => {
    const quarantine = new Quarantine(
      { maxCount: 10, maxBytes: 1_000_000, evictionPolicy: 'priority' },
      new AuditChain(),
    )
    const agent = new Agent(
      { maxPayloadSize: 1_000_000 },
      quarantine,
      createRateLimiter({ windowMs: 60_000, maxRequests: 100, blockDurationMs: 300_000 }),
      createEvidenceFactory(),
    )

    const result = agent.intercept(
      createThreatScent('membrane-regression', { attack: 'payload-egress' }, 'high'),
    )

    expect(result.status).toBe('quarantined')
    if (result.status !== 'quarantined') {
      return
    }

    let membraneError: unknown
    try {
      void result.handle.bytes
    } catch (error: unknown) {
      membraneError = error
    }

    expect(membraneError).toMatchObject({
      state: 'runtime',
      code: 'RUNTIME_MEMBRANE_VIOLATION',
      recoverable: false,
    })
    expect(agent.getStats().membraneRejectionCount).toBe(1)
  })
})
