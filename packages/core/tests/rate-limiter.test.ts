/**
 * Rate Limiter tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRateLimiter, RateLimiter } from '../src/core/rate-limiter.js'
import type { RateLimitConfig } from '../src/types/config.js'

describe('RateLimiter', () => {
  let config: RateLimitConfig

  beforeEach(() => {
    config = {
      windowMs: 60_000, // 1 minute
      maxRequests: 5,
      blockDurationMs: 300_000, // 5 minutes
    }
  })

  describe('construction', () => {
    it('creates with valid config', () => {
      const limiter = new RateLimiter(config)
      expect(limiter).toBeDefined()
    })

    it('throws on non-positive windowMs', () => {
      expect(() => new RateLimiter({ ...config, windowMs: 0 })).toThrow('windowMs must be positive')
      expect(() => new RateLimiter({ ...config, windowMs: -1 })).toThrow(
        'windowMs must be positive'
      )
    })

    it('throws on non-positive maxRequests', () => {
      expect(() => new RateLimiter({ ...config, maxRequests: 0 })).toThrow(
        'maxRequests must be positive'
      )
    })

    it('throws on negative blockDurationMs', () => {
      expect(() => new RateLimiter({ ...config, blockDurationMs: -1 })).toThrow(
        'blockDurationMs cannot be negative'
      )
    })

    it('allows zero blockDurationMs (no blocking)', () => {
      const limiter = new RateLimiter({ ...config, blockDurationMs: 0 })
      expect(limiter).toBeDefined()
    })
  })

  describe('check', () => {
    it('allows requests within limit', () => {
      const limiter = new RateLimiter(config)

      for (let i = 0; i < config.maxRequests; i++) {
        const result = limiter.check('source-1')
        expect(result.allowed).toBe(true)
      }
    })

    it('rejects after limit exceeded', () => {
      const limiter = new RateLimiter(config)

      // Use up all requests
      for (let i = 0; i < config.maxRequests; i++) {
        limiter.check('source-1')
      }

      // Next request should be rejected
      const result = limiter.check('source-1')
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.blocked).toBe(true)
        expect(result.retryAfter).toBe(config.blockDurationMs)
      }
    })

    it('returns blocked: true when in block period', () => {
      const limiter = new RateLimiter(config)

      // Exceed limit
      for (let i = 0; i <= config.maxRequests; i++) {
        limiter.check('source-1')
      }

      // Subsequent requests during block
      const result = limiter.check('source-1')
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.blocked).toBe(true)
      }
    })

    it('returns blocked: false when no block configured', () => {
      const limiter = new RateLimiter({ ...config, blockDurationMs: 0 })

      // Exceed limit
      for (let i = 0; i < config.maxRequests; i++) {
        limiter.check('source-1')
      }

      const result = limiter.check('source-1')
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.blocked).toBe(false)
      }
    })

    it('tracks sources independently', () => {
      const limiter = new RateLimiter(config)

      // Exhaust source-1
      for (let i = 0; i < config.maxRequests; i++) {
        limiter.check('source-1')
      }
      expect(limiter.check('source-1').allowed).toBe(false)

      // source-2 should still be allowed
      expect(limiter.check('source-2').allowed).toBe(true)
    })

    it('returns correct retryAfter when blocked', () => {
      const limiter = new RateLimiter(config)

      // Exceed limit to trigger block
      for (let i = 0; i <= config.maxRequests; i++) {
        limiter.check('source-1')
      }

      const result = limiter.check('source-1')
      if (!result.allowed) {
        expect(result.retryAfter).toBeGreaterThan(0)
        expect(result.retryAfter).toBeLessThanOrEqual(config.blockDurationMs)
      }
    })
  })

  describe('reset', () => {
    it('clears rate limit for source', () => {
      const limiter = new RateLimiter(config)

      // Exhaust and block source
      for (let i = 0; i <= config.maxRequests; i++) {
        limiter.check('source-1')
      }
      expect(limiter.check('source-1').allowed).toBe(false)

      // Reset
      limiter.reset('source-1')

      // Should be allowed again
      expect(limiter.check('source-1').allowed).toBe(true)
    })

    it('does not affect other sources', () => {
      const limiter = new RateLimiter(config)

      // Use some requests for both sources
      limiter.check('source-1')
      limiter.check('source-2')

      limiter.reset('source-1')

      // source-2 should retain its count
      expect(limiter.stats.sources).toBe(1)
    })
  })

  describe('cleanup', () => {
    it('removes stale entries', () => {
      const limiter = new RateLimiter(config)

      // Create an entry
      limiter.check('source-1')
      expect(limiter.stats.sources).toBe(1)

      // Mock time passing
      vi.useFakeTimers()
      vi.advanceTimersByTime(config.windowMs + config.blockDurationMs + 1000)

      const cleaned = limiter.cleanup()
      expect(cleaned).toBe(1)
      expect(limiter.stats.sources).toBe(0)

      vi.useRealTimers()
    })

    it('does not remove active entries', () => {
      const limiter = new RateLimiter(config)

      limiter.check('source-1')

      // Immediate cleanup should not remove
      const cleaned = limiter.cleanup()
      expect(cleaned).toBe(0)
      expect(limiter.stats.sources).toBe(1)
    })

    it('does not remove blocked entries before expiry', () => {
      const limiter = new RateLimiter(config)

      // Block source
      for (let i = 0; i <= config.maxRequests; i++) {
        limiter.check('source-1')
      }

      vi.useFakeTimers()
      // Advance past stale threshold but not block expiry
      vi.advanceTimersByTime(config.windowMs + 1000)

      const cleaned = limiter.cleanup()
      expect(cleaned).toBe(0) // Still blocked, not cleaned

      vi.useRealTimers()
    })
  })

  describe('stats', () => {
    it('tracks total sources', () => {
      const limiter = new RateLimiter(config)

      limiter.check('source-1')
      limiter.check('source-2')
      limiter.check('source-3')

      expect(limiter.stats.sources).toBe(3)
    })

    it('tracks blocked sources', () => {
      const limiter = new RateLimiter(config)

      // Block source-1
      for (let i = 0; i <= config.maxRequests; i++) {
        limiter.check('source-1')
      }

      expect(limiter.stats.blocked).toBe(1)
    })

    it('tracks total checks', () => {
      const limiter = new RateLimiter(config)

      limiter.check('source-1')
      limiter.check('source-1')
      limiter.check('source-2')

      expect(limiter.stats.totalChecks).toBe(3)
    })

    it('tracks total rejections', () => {
      const limiter = new RateLimiter(config)

      // Use up limit
      for (let i = 0; i < config.maxRequests; i++) {
        limiter.check('source-1')
      }

      // These should be rejected
      limiter.check('source-1')
      limiter.check('source-1')

      expect(limiter.stats.totalRejections).toBe(2)
    })
  })

  describe('createRateLimiter factory', () => {
    it('creates a rate limiter instance', () => {
      const limiter = createRateLimiter(config)
      expect(limiter.check('test').allowed).toBe(true)
    })
  })
})
