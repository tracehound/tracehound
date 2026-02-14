/**
 * Tests for tracehound.ts - Main API factory
 */

import { describe, expect, it } from 'vitest'
import { createTracehound } from '../src/core/tracehound.js'

describe('Tracehound Factory', () => {
  describe('createTracehound', () => {
    it('should create tracehound instance with default config', () => {
      const tracehound = createTracehound()

      expect(tracehound).toBeDefined()
      expect(tracehound.agent).toBeDefined()
      expect(tracehound.quarantine).toBeDefined()
      expect(tracehound.rateLimiter).toBeDefined()
      expect(tracehound.watcher).toBeDefined()
      expect(tracehound.auditChain).toBeDefined()
      expect(tracehound.notifications).toBeDefined()
      expect(tracehound.houndPool).toBeDefined()
    })

    it('should accept custom maxPayloadSize', () => {
      const tracehound = createTracehound({
        maxPayloadSize: 500_000,
      })

      expect(tracehound.agent).toBeDefined()
    })

    it('should accept custom quarantine config', () => {
      const tracehound = createTracehound({
        quarantine: {
          maxCount: 5000,
          maxBytes: 50_000_000,
        },
      })

      expect(tracehound.quarantine).toBeDefined()
      expect(tracehound.quarantine.stats.count).toBe(0)
    })

    it('should accept custom rate limit config', () => {
      const tracehound = createTracehound({
        rateLimit: {
          windowMs: 30_000,
          maxRequests: 50,
          blockDurationMs: 60_000,
        },
      })

      expect(tracehound.rateLimiter).toBeDefined()
    })

    it('should accept custom watcher config', () => {
      const tracehound = createTracehound({
        watcher: {
          maxAlertsPerWindow: 5,
          alertWindowMs: 10_000,
          quarantineHighWatermark: 0.9,
        },
      })

      expect(tracehound.watcher).toBeDefined()
    })

    it('should accept custom hound pool config', () => {
      const tracehound = createTracehound({
        houndPool: {
          poolSize: 2,
          timeout: 15_000,
          rotationJitterMs: 500,
          onPoolExhausted: 'drop',
        },
      })

      expect(tracehound.houndPool).toBeDefined()
    })

    it('should use default values when config not provided', () => {
      const tracehound = createTracehound({})

      expect(tracehound.quarantine).toBeDefined()
      expect(tracehound.quarantine.stats.count).toBe(0)
    })

    it('should initialize all components correctly', () => {
      const tracehound = createTracehound()

      // Verify components are initialized and connected
      expect(tracehound.auditChain.length).toBe(0)
      expect(tracehound.notifications.stats.totalEmitted).toBe(0)
      expect(tracehound.quarantine.stats.count).toBe(0)
    })
  })
})
