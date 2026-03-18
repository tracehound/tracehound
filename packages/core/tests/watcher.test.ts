/**
 * Watcher tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWatcher, type IWatcher } from '../src/core/watcher.js'

describe('Watcher', () => {
  let watcher: IWatcher

  beforeEach(() => {
    vi.useFakeTimers()
    watcher = createWatcher({
      maxAlertsPerWindow: 5,
      alertWindowMs: 60_000,
      quarantineHighWatermark: 0.8,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('snapshot()', () => {
    it('returns immutable snapshot', () => {
      const snapshot = watcher.snapshot()

      expect(Object.isFrozen(snapshot)).toBe(true)
    })

    it('includes uptime', () => {
      vi.advanceTimersByTime(1000)

      const snapshot = watcher.snapshot()

      expect(snapshot.uptimeMs).toBeGreaterThanOrEqual(1000)
    })

    it('includes threat stats', () => {
      watcher.recordThreat('injection', 'high')
      watcher.recordThreat('ddos', 'critical')

      const snapshot = watcher.snapshot()

      expect(snapshot.threats.total).toBe(2)
      expect(snapshot.threats.byCategory['injection']).toBe(1)
      expect(snapshot.threats.byCategory['ddos']).toBe(1)
      expect(snapshot.threats.bySeverity.high).toBe(1)
      expect(snapshot.threats.bySeverity.critical).toBe(1)
    })

    it('includes quarantine stats', () => {
      watcher.updateQuarantine(5, 1000, 10000)

      const snapshot = watcher.snapshot()

      expect(snapshot.quarantine.count).toBe(5)
      expect(snapshot.quarantine.bytes).toBe(1000)
      expect(snapshot.quarantine.capacityPercent).toBe(10)
    })
  })

  describe('recordThreat()', () => {
    it('increments total threats', () => {
      watcher.recordThreat('spam', 'low')
      watcher.recordThreat('spam', 'low')

      expect(watcher.snapshot().threats.total).toBe(2)
    })

    it('tracks by category', () => {
      watcher.recordThreat('injection', 'high')
      watcher.recordThreat('injection', 'high')
      watcher.recordThreat('ddos', 'medium')

      const snapshot = watcher.snapshot()

      expect(snapshot.threats.byCategory['injection']).toBe(2)
      expect(snapshot.threats.byCategory['ddos']).toBe(1)
    })

    it('tracks by severity', () => {
      watcher.recordThreat('test', 'low')
      watcher.recordThreat('test', 'high')
      watcher.recordThreat('test', 'high')

      const snapshot = watcher.snapshot()

      expect(snapshot.threats.bySeverity.low).toBe(1)
      expect(snapshot.threats.bySeverity.high).toBe(2)
    })
  })

  describe('updateQuarantine()', () => {
    it('updates quarantine stats', () => {
      watcher.updateQuarantine(10, 5000, 10000)

      const snapshot = watcher.snapshot()

      expect(snapshot.quarantine.count).toBe(10)
      expect(snapshot.quarantine.bytes).toBe(5000)
      expect(snapshot.quarantine.capacityPercent).toBe(50)
    })

    it('emits alert at high watermark', () => {
      // 80% watermark
      watcher.updateQuarantine(80, 8000, 10000)

      const snapshot = watcher.snapshot()

      expect(snapshot.lastAlert).not.toBeNull()
      expect(snapshot.lastAlert?.type).toBe('quarantine_high')
    })

    it('does not emit alert below watermark', () => {
      // 70% < 80% watermark
      watcher.updateQuarantine(70, 7000, 10000)

      const snapshot = watcher.snapshot()

      expect(snapshot.lastAlert).toBeNull()
    })
  })

  describe('alert()', () => {
    it('creates alert with id and timestamp', () => {
      const result = watcher.alert({
        type: 'threat_detected',
        severity: 'warning',
        message: 'Test alert',
      })

      expect(result).toBe(true)

      const snapshot = watcher.snapshot()
      expect(snapshot.lastAlert).not.toBeNull()
      expect(snapshot.lastAlert?.id).toMatch(/^[0-9a-f-]+$/)
      expect(snapshot.lastAlert?.timestamp).toBeGreaterThan(0)
    })

    it('rate limits alerts', () => {
      // Max 5 per window
      for (let i = 0; i < 10; i++) {
        watcher.alert({
          type: 'threat_detected',
          severity: 'info',
          message: `Alert ${i}`,
        })
      }

      const snapshot = watcher.snapshot()

      expect(snapshot.totalAlerts).toBe(5) // Rate limited
      expect(snapshot.alertsInWindow).toBe(5)
    })

    it('resets window after time passes', () => {
      // Fill window
      for (let i = 0; i < 5; i++) {
        watcher.alert({
          type: 'threat_detected',
          severity: 'info',
          message: `Alert ${i}`,
        })
      }

      expect(watcher.snapshot().alertsInWindow).toBe(5)

      // Advance past window
      vi.advanceTimersByTime(60_001)

      // Should be able to alert again
      const result = watcher.alert({
        type: 'threat_detected',
        severity: 'info',
        message: 'New window',
      })

      expect(result).toBe(true)
      expect(watcher.snapshot().alertsInWindow).toBe(1)
    })

    it('returns false when rate limited', () => {
      // Fill window
      for (let i = 0; i < 5; i++) {
        watcher.alert({
          type: 'threat_detected',
          severity: 'info',
          message: `Alert ${i}`,
        })
      }

      const result = watcher.alert({
        type: 'threat_detected',
        severity: 'info',
        message: 'Should be rate limited',
      })

      expect(result).toBe(false)
    })

    it('trims oldest alerts when maxAlerts capacity is exceeded', () => {
      const limitedWatcher = createWatcher({
        maxAlertsPerWindow: 10,
        alertWindowMs: 60_000,
        quarantineHighWatermark: 0.8,
        maxAlerts: 2,
      })

      expect(
        limitedWatcher.alert({
          type: 'threat_detected',
          severity: 'info',
          message: 'a1',
        }),
      ).toBe(true)
      expect(
        limitedWatcher.alert({
          type: 'threat_detected',
          severity: 'info',
          message: 'a2',
        }),
      ).toBe(true)
      expect(
        limitedWatcher.alert({
          type: 'threat_detected',
          severity: 'info',
          message: 'a3',
        }),
      ).toBe(true)

      const snapshot = limitedWatcher.snapshot()
      expect(snapshot.totalAlerts).toBe(2)
      expect(snapshot.lastAlert?.message).toBe('a3')
    })
  })

  describe('setOverloaded()', () => {
    it('updates overloaded state', () => {
      expect(watcher.snapshot().overloaded).toBe(false)

      watcher.setOverloaded(true)

      expect(watcher.snapshot().overloaded).toBe(true)
    })

    it('emits alert on transition to overloaded', () => {
      watcher.setOverloaded(true)

      const snapshot = watcher.snapshot()

      expect(snapshot.lastAlert?.type).toBe('system_overload')
      expect(snapshot.lastAlert?.severity).toBe('critical')
    })

    it('does not emit alert when already overloaded', () => {
      watcher.setOverloaded(true)
      const firstAlert = watcher.snapshot().lastAlert

      watcher.setOverloaded(true) // Already overloaded

      expect(watcher.snapshot().lastAlert?.id).toBe(firstAlert?.id)
    })
  })

  describe('No EventEmitter', () => {
    it('has no on/off/emit methods', () => {
      const w = watcher as unknown as Record<string, unknown>
      expect(w['on']).toBeUndefined()
      expect(w['off']).toBeUndefined()
      expect(w['emit']).toBeUndefined()
      expect(w['addEventListener']).toBeUndefined()
    })
  })

  describe('Injectable clock', () => {
    it('should use injected _now for uptime calculation', () => {
      let fakeTime = 5_000_000
      const mockNow = (): number => fakeTime

      const w = createWatcher({
        maxAlertsPerWindow: 10,
        alertWindowMs: 60_000,
        quarantineHighWatermark: 0.8,
        _now: mockNow,
      })

      fakeTime += 2_500
      expect(w.snapshot().uptimeMs).toBe(2_500)

      fakeTime += 7_500
      expect(w.snapshot().uptimeMs).toBe(10_000)
    })

    it('should use injected _now for alert window reset', () => {
      let fakeTime = 5_000_000
      const mockNow = (): number => fakeTime

      const w = createWatcher({
        maxAlertsPerWindow: 3,
        alertWindowMs: 1_000,
        quarantineHighWatermark: 0.8,
        _now: mockNow,
      })

      // Fill window
      w.alert({ type: 'threat_detected', severity: 'info', message: 'a' })
      w.alert({ type: 'threat_detected', severity: 'info', message: 'b' })
      w.alert({ type: 'threat_detected', severity: 'info', message: 'c' })
      expect(w.snapshot().alertsInWindow).toBe(3)

      // Rate limited
      expect(w.alert({ type: 'threat_detected', severity: 'info', message: 'd' })).toBe(false)

      // Advance injected clock past alert window
      fakeTime += 1_001
      expect(w.alert({ type: 'threat_detected', severity: 'info', message: 'e' })).toBe(true)
      expect(w.snapshot().alertsInWindow).toBe(1)
    })

    it('should use injected _now for alert timestamp', () => {
      const fakeTime = 9_999_999
      const mockNow = (): number => fakeTime

      const w = createWatcher({
        maxAlertsPerWindow: 10,
        alertWindowMs: 60_000,
        quarantineHighWatermark: 0.8,
        _now: mockNow,
      })

      w.alert({ type: 'threat_detected', severity: 'warning', message: 'ts-test' })
      expect(w.snapshot().lastAlert?.timestamp).toBe(fakeTime)
    })

    it('should use injected _now for snapshot snapshotTime', () => {
      const fakeTime = 7_777_777
      const mockNow = (): number => fakeTime

      const w = createWatcher({
        maxAlertsPerWindow: 10,
        alertWindowMs: 60_000,
        quarantineHighWatermark: 0.8,
        _now: mockNow,
      })

      expect(w.snapshot().snapshotTime).toBe(fakeTime)
    })
  })
})
