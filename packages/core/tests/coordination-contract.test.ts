/**
 * RFC-0009 coordination contract tests
 */

import { describe, expect, it } from 'vitest'
import type {
  CoordinationFeature,
  CoordinationHealth,
  CoordinationProvider,
} from '../src/types/coordination.js'

describe('RFC-0009 Coordination Contract', () => {
  it('should define explicit health modes for fail-open visibility', () => {
    const local: CoordinationHealth = {
      mode: 'local',
      lastSyncAt: null,
      syncLagMs: null,
      provider: 'none',
    }

    const degraded: CoordinationHealth = {
      mode: 'degraded',
      lastSyncAt: Date.now(),
      syncLagMs: 500,
      provider: 'provider-a',
    }

    const synchronized: CoordinationHealth = {
      mode: 'synchronized',
      lastSyncAt: Date.now(),
      syncLagMs: 0,
      provider: 'provider-a',
    }

    expect(local.mode).toBe('local')
    expect(degraded.mode).toBe('degraded')
    expect(synchronized.mode).toBe('synchronized')
  })

  it('should support optional sync operations while preserving required lifecycle methods', async () => {
    const features: ReadonlySet<CoordinationFeature> = new Set<CoordinationFeature>([
      'shared_blocklist',
      'global_rate_limit',
    ])

    const provider: CoordinationProvider = {
      providerId: 'coord-provider',
      features,
      start: async (): Promise<void> => {},
      stop: async (): Promise<void> => {},
      health: (): CoordinationHealth => ({
        mode: 'local',
        lastSyncAt: null,
        syncLagMs: null,
        provider: 'coord-provider',
      }),
      syncBlocklist: async (_entries: ReadonlyArray<string>): Promise<void> => {},
    }

    await provider.start()
    await provider.syncBlocklist?.(['sig-1'])
    await provider.stop()

    expect(provider.health().provider).toBe('coord-provider')
    expect(provider.features.has('shared_blocklist')).toBe(true)
  })
})
