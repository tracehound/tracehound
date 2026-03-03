import { beforeEach, describe, expect, it } from 'vitest'
import { SecurityState, createSecurityState } from '../src/core/security-state.js'

describe('SecurityState', () => {
  let state: SecurityState

  beforeEach(() => {
    state = new SecurityState({ quarantineMaxBytes: 100_000_000 })
  })

  describe('snapshot', () => {
    it('returns immutable snapshot', () => {
      const snapshot = state.snapshot()

      expect(snapshot.timestamp).toBeGreaterThan(0)
      expect(snapshot.uptimeMs).toBeGreaterThanOrEqual(0)
      expect(Object.isFrozen(snapshot)).toBe(true)
    })

    it('starts with default values', () => {
      const snapshot = state.snapshot()

      expect(snapshot.threats.total).toBe(0)
      expect(snapshot.quarantine.count).toBe(0)
      expect(snapshot.license.tier).toBe('starter')
      expect(snapshot.health).toBe('healthy')
    })
  })

  describe('recordThreat', () => {
    it('increments total count', () => {
      state.recordThreat('injection', 'high')
      state.recordThreat('dos', 'medium')

      const snapshot = state.snapshot()
      expect(snapshot.threats.total).toBe(2)
    })

    it('tracks by category', () => {
      state.recordThreat('injection', 'high')
      state.recordThreat('injection', 'critical')
      state.recordThreat('dos', 'medium')

      const snapshot = state.snapshot()
      expect(snapshot.threats.byCategory['injection']).toBe(2)
      expect(snapshot.threats.byCategory['dos']).toBe(1)
    })

    it('tracks by severity', () => {
      state.recordThreat('test', 'high')
      state.recordThreat('test', 'high')
      state.recordThreat('test', 'critical')

      const snapshot = state.snapshot()
      expect(snapshot.threats.bySeverity.high).toBe(2)
      expect(snapshot.threats.bySeverity.critical).toBe(1)
    })

    it('adds to history', () => {
      state.recordThreat('injection', 'high')

      expect(state.history).toHaveLength(1)
      expect(state.history[0]?.type).toBe('threat')
    })
  })

  describe('updateQuarantine', () => {
    it('updates quarantine stats', () => {
      state.updateQuarantine(10, 50000)

      const snapshot = state.snapshot()
      expect(snapshot.quarantine.count).toBe(10)
      expect(snapshot.quarantine.bytes).toBe(50000)
    })

    it('calculates capacity percent', () => {
      state.updateQuarantine(0, 70_000_000)

      const snapshot = state.snapshot()
      expect(snapshot.quarantine.capacityPercent).toBe(70)
    })
  })

  describe('updateLicense', () => {
    it('updates license state', () => {
      state.updateLicense('pro', 'valid', 30)

      const snapshot = state.snapshot()
      expect(snapshot.license.tier).toBe('pro')
      expect(snapshot.license.status).toBe('valid')
      expect(snapshot.license.daysRemaining).toBe(30)
    })
  })

  describe('health calculation', () => {
    it('returns critical when capacity > 90%', () => {
      state.updateQuarantine(0, 95_000_000)

      const snapshot = state.snapshot()
      expect(snapshot.health).toBe('critical')
    })

    it('returns critical when license expired', () => {
      state.updateLicense('pro', 'expired')

      const snapshot = state.snapshot()
      expect(snapshot.health).toBe('critical')
    })

    it('returns degraded when capacity > 70%', () => {
      state.updateQuarantine(0, 75_000_000)

      const snapshot = state.snapshot()
      expect(snapshot.health).toBe('degraded')
    })

    it('returns degraded when in grace period', () => {
      state.updateLicense('pro', 'grace', -3)

      const snapshot = state.snapshot()
      expect(snapshot.health).toBe('degraded')
    })
  })

  describe('history', () => {
    it('records different event types', () => {
      state.recordThreat('test', 'low')
      state.recordEvidence('sig-1', 100, 'medium')
      state.recordEviction('sig-1', 'capacity')
      state.recordRateLimit('192.168.1.1', true)
      state.recordPanic('warning', 'test panic')

      expect(state.history).toHaveLength(5)
      expect(state.history.map((e) => e.type)).toEqual([
        'threat',
        'evidence',
        'eviction',
        'rate_limit',
        'panic',
      ])
    })

    it('prunes old entries when max exceeded', () => {
      const smallState = new SecurityState({ maxHistorySize: 3 })

      smallState.recordThreat('1', 'low')
      smallState.recordThreat('2', 'low')
      smallState.recordThreat('3', 'low')
      smallState.recordThreat('4', 'low')

      expect(smallState.history).toHaveLength(3)
    })
  })

  describe('stats', () => {
    it('tracks history size', () => {
      state.recordThreat('test', 'low')
      state.recordThreat('test', 'low')

      expect(state.stats.historySize).toBe(2)
    })

    it('returns null for empty history', () => {
      expect(state.stats.oldestEntry).toBeNull()
      expect(state.stats.newestEntry).toBeNull()
    })

    it('correctly reports oldest and newest entries when history wraps around (ring buffer)', async () => {
      const smallState = new SecurityState({ maxHistorySize: 3 })

      // Add 1
      smallState.recordThreat('type1', 'low')
      await new Promise((resolve) => setTimeout(resolve, 5))

      // Add 2
      smallState.recordThreat('type2', 'low')
      await new Promise((resolve) => setTimeout(resolve, 5))
      const oldestExpected = smallState.history[1]!.timestamp

      // Add 3
      smallState.recordThreat('type3', 'low')
      await new Promise((resolve) => setTimeout(resolve, 5))

      // Add 4 (overwrites 1)
      smallState.recordThreat('type4', 'low')
      const newestExpected = smallState.history[2]!.timestamp

      expect(smallState.stats.historySize).toBe(3)
      expect(smallState.stats.oldestEntry).toBe(oldestExpected)
      expect(smallState.stats.newestEntry).toBe(newestExpected)
    })
  })

  describe('factory function', () => {
    it('creates a SecurityState instance', () => {
      const ss = createSecurityState()
      const snapshot = ss.snapshot()
      expect(snapshot.threats.total).toBe(0)
    })
  })
})
