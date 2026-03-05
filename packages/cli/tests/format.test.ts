import { describe, expect, it } from 'vitest'
import { formatBytes, formatDurationMs } from '../src/lib/format.js'

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
})
