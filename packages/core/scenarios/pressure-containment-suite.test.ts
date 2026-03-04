/**
 * Pressure Containment Scenario Suite (TH-M3-0011-04)
 *
 * Scenario coverage goals:
 * 1. Pressure containment keeps memory bounded via deterministic Drop and Count.
 * 2. Coordination degradation remains fail-open for intercept flow.
 * 3. Runtime membrane blocks payload egress from quarantined handles.
 */

import { describe, expect, it } from 'vitest'
import {
  AuditChain,
  createAgent,
  createEvidenceFactory,
  createRateLimiter,
  Quarantine,
  type CoordinationFeature,
  type CoordinationHealth,
  type CoordinationProvider,
  type Scent,
} from '../src/index.js'

function createThreatScent(
  id: string,
  payload: Scent['payload'],
  severity: 'low' | 'medium' | 'high' | 'critical' = 'high',
): Scent {
  return {
    id,
    timestamp: Date.now(),
    source: `scenario-${id}`,
    payload,
    threat: { category: 'injection', severity },
  }
}

describe('Pressure Containment Scenario Suite', () => {
  it('keeps quarantine bounded by dropping low-priority overflow under pressure', () => {
    const quarantine = new Quarantine(
      { maxCount: 1, maxBytes: 1_000_000, evictionPolicy: 'priority' },
      new AuditChain(),
    )
    const agent = createAgent(
      { maxPayloadSize: 1_000_000 },
      quarantine,
      createRateLimiter({ windowMs: 60_000, maxRequests: 100, blockDurationMs: 300_000 }),
      createEvidenceFactory(),
    )

    const first = agent.intercept(
      createThreatScent('pressure-critical', { attack: 'critical-anchor' }, 'critical'),
    )
    const second = agent.intercept(
      createThreatScent('pressure-low', { attack: 'low-overflow' }, 'low'),
    )

    expect(first.status).toBe('quarantined')
    expect(second.status).toBe('ignored')
    expect(quarantine.stats.count).toBe(1)
    expect(quarantine.stats.bySeverity.critical).toBe(1)
    expect(quarantine.stats.droppedCount).toBe(1)
    expect(quarantine.stats.droppedBytes).toBeGreaterThan(0)
  })

  it('preserves quarantining flow while coordination health is degraded', () => {
    const provider: CoordinationProvider = {
      providerId: 'scenario-degraded-provider',
      features: new Set<CoordinationFeature>(['shared_blocklist']),
      start: async (): Promise<void> => {},
      stop: async (): Promise<void> => {},
      health: (): CoordinationHealth => ({
        mode: 'degraded',
        lastSyncAt: null,
        syncLagMs: null,
        provider: 'scenario-degraded-provider',
      }),
    }

    const quarantine = new Quarantine(
      { maxCount: 10, maxBytes: 1_000_000, evictionPolicy: 'priority' },
      new AuditChain(),
    )
    const agent = createAgent(
      { maxPayloadSize: 1_000_000, coordinationProvider: provider },
      quarantine,
      createRateLimiter({ windowMs: 60_000, maxRequests: 100, blockDurationMs: 300_000 }),
      createEvidenceFactory(),
    )

    const health = agent.getCoordinationHealth()
    const result = agent.intercept(
      createThreatScent('coordination-degraded', { attack: 'coordination-path' }, 'high'),
    )

    expect(health.mode).toBe('degraded')
    expect(health.provider).toBe('scenario-degraded-provider')
    expect(result.status).toBe('quarantined')
    expect(quarantine.stats.count).toBe(1)
  })

  it('enforces metadata-only runtime membrane for quarantined scenario handles', () => {
    const quarantine = new Quarantine(
      { maxCount: 10, maxBytes: 1_000_000, evictionPolicy: 'priority' },
      new AuditChain(),
    )
    const agent = createAgent(
      { maxPayloadSize: 1_000_000 },
      quarantine,
      createRateLimiter({ windowMs: 60_000, maxRequests: 100, blockDurationMs: 300_000 }),
      createEvidenceFactory(),
    )

    const result = agent.intercept(
      createThreatScent('membrane-scenario', { attack: 'payload-egress-attempt' }, 'high'),
    )

    expect(result.status).toBe('quarantined')
    if (result.status !== 'quarantined') {
      return
    }

    expect(result.handle.membrane).toBe('metadata_only')
    expect(() => result.handle.bytes).toThrow()
    expect(() => result.handle.transfer()).toThrow()
    expect(() => result.handle.neutralize('previous-hash')).toThrow()
    expect(() => result.handle.evacuate('cold-storage')).toThrow()
  })
})
