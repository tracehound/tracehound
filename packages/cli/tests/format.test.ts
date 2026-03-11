import { describe, expect, it } from 'vitest'
import {
  fmtAgo,
  fmtBytes,
  fmtCount,
  fmtDuration,
  fmtStatus,
  fmtUptime,
  formatBytes,
  formatDurationMs,
} from '../src/lib/format.js'

describe('CLI format utilities', () => {
  describe('formatBytes', () => {
    it('should format zero bytes', () => {
      expect(formatBytes(0)).toBe('0 B')
    })

    it('should format values across unit boundaries', () => {
      expect(formatBytes(1024)).toBe('1.0 KB')
      expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB')
    })
  })

  describe('formatDurationMs', () => {
    it('should format sub-second durations', () => {
      expect(formatDurationMs(250)).toBe('250ms')
    })

    it('should format second and minute ranges', () => {
      expect(formatDurationMs(1_500)).toBe('1s')
      expect(formatDurationMs(60_000)).toBe('1m')
      expect(formatDurationMs(3 * 60_000)).toBe('3m')
    })

    it('should format hour and day ranges', () => {
      expect(formatDurationMs(2 * 3_600_000 + 5 * 60_000)).toBe('2h 5m')
      expect(formatDurationMs(24 * 3_600_000 + 2 * 3_600_000)).toBe('1d 2h')
    })
  })

  describe('fmtBytes', () => {
    it('should be an alias for formatBytes', () => {
      expect(fmtBytes(0)).toBe('0 B')
      expect(fmtBytes(2048)).toBe('2.0 KB')
    })
  })

  describe('fmtCount', () => {
    it('should format numbers with thousands separators', () => {
      expect(fmtCount(0)).toBe('0')
      expect(fmtCount(1000)).toBe('1,000')
      expect(fmtCount(1_000_000)).toBe('1,000,000')
    })
  })

  describe('fmtDuration', () => {
    it('should format sub-second durations', () => {
      expect(fmtDuration(500)).toBe('500ms')
    })

    it('should format seconds', () => {
      expect(fmtDuration(5_000)).toBe('5s')
    })

    it('should format minutes', () => {
      expect(fmtDuration(90_000)).toBe('1m')
    })

    it('should format hours with minutes', () => {
      expect(fmtDuration(3_600_000 + 30 * 60_000)).toBe('1h 30m')
    })

    it('should format days with hours and minutes', () => {
      expect(fmtDuration(86_400_000 + 2 * 3_600_000 + 5 * 60_000)).toBe('1d 2h 5m')
    })
  })

  describe('fmtUptime', () => {
    it('should format minutes only', () => {
      expect(fmtUptime(65)).toBe('1m')
    })

    it('should format hours and minutes', () => {
      expect(fmtUptime(3_600 + 30 * 60)).toBe('1h 30m')
    })

    it('should format days with hours and minutes', () => {
      expect(fmtUptime(86_400 + 2 * 3_600 + 10 * 60)).toBe('1d 2h 10m')
    })
  })

  describe('fmtAgo', () => {
    it('should return just now for future or zero diff', () => {
      expect(fmtAgo(1000, 1000)).toBe('just now')
      expect(fmtAgo(2000, 1000)).toBe('just now')
    })

    it('should format seconds ago', () => {
      expect(fmtAgo(0, 30_000)).toBe('30s ago')
    })

    it('should format minutes ago', () => {
      expect(fmtAgo(0, 5 * 60_000)).toBe('5m ago')
    })

    it('should format hours ago', () => {
      expect(fmtAgo(0, 3 * 3_600_000)).toBe('3h ago')
    })
  })

  describe('fmtStatus', () => {
    it('should uppercase the status string', () => {
      expect(fmtStatus('healthy')).toBe('HEALTHY')
      expect(fmtStatus('degraded')).toBe('DEGRADED')
      expect(fmtStatus('critical')).toBe('CRITICAL')
    })
  })
})
