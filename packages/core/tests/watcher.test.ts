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
      expect(snapshot.threats.byCategory.injection).toBe(1)
      expect(snapshot.threats.byCategory.ddos).toBe(1)
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

      expect(snapshot.threats.byCategory.injection).toBe(2)
      expect(snapshot.threats.byCategory.ddos).toBe(1)
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
      expect(snapshot.lastAlert?.id).toMatch(/^alert-\d+$/)
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
      expect((watcher as any).on).toBeUndefined()
      expect((watcher as any).off).toBeUndefined()
      expect((watcher as any).emit).toBeUndefined()
      expect((watcher as any).addEventListener).toBeUndefined()
    })
  })
})
