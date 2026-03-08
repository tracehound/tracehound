/**
 * Rate Limiter tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRateLimiter, RateLimiter } from '../src/core/rate-limiter.js'
import type { RateLimitConfig } from '../src/types/config.js'
import type { ScentSource } from '../src/types/scent.js'

/**
 * Helper to create ScentSource for testing
 */
function createSource(
  ip: string,
  userAgent?: string,
  tls?: { cipherSuite: string; version: string; alpn?: string },
): ScentSource {
  return {
    ip,
    ...(userAgent ? { userAgent } : {}),
    ...(tls ? { tls } : {}),
  }
}

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
        'windowMs must be positive',
      )
    })

    it('throws on non-positive maxRequests', () => {
      expect(() => new RateLimiter({ ...config, maxRequests: 0 })).toThrow(
        'maxRequests must be positive',
      )
    })

    it('throws on non-positive maxSources when provided', () => {
      expect(() => new RateLimiter({ ...config, maxSources: 0 })).toThrow(
        'maxSources must be positive',
      )
      expect(() => new RateLimiter({ ...config, maxSources: -1 })).toThrow(
        'maxSources must be positive',
      )
    })

    it('throws on negative blockDurationMs', () => {
      expect(() => new RateLimiter({ ...config, blockDurationMs: -1 })).toThrow(
        'blockDurationMs cannot be negative',
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
        const result = limiter.check(createSource('source-1'))
        expect(result.allowed).toBe(true)
      }
    })

    it('rejects after limit exceeded', () => {
      const limiter = new RateLimiter(config)

      // Use up all requests
      for (let i = 0; i < config.maxRequests; i++) {
        limiter.check(createSource('source-1'))
      }

      // Next request should be rejected
      const result = limiter.check(createSource('source-1'))
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
        limiter.check(createSource('source-1'))
      }

      // Subsequent requests during block
      const result = limiter.check(createSource('source-1'))
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.blocked).toBe(true)
      }
    })

    it('clears block state after block duration passes and allows requests again', () => {
      vi.useFakeTimers()
      const limiter = new RateLimiter({
        windowMs: 500,
        maxRequests: 1,
        blockDurationMs: 1_000,
      })

      expect(limiter.check(createSource('block-expiry')).allowed).toBe(true)
      const blocked = limiter.check(createSource('block-expiry'))
      expect(blocked.allowed).toBe(false)
      if (!blocked.allowed) {
        expect(blocked.blocked).toBe(true)
      }

      // Advance past both block duration and IP ceiling window.
      vi.advanceTimersByTime(1_200)

      const afterExpiry = limiter.check(createSource('block-expiry'))
      expect(afterExpiry.allowed).toBe(true)

      vi.useRealTimers()
    })

    it('returns blocked: false when no block configured', () => {
      const limiter = new RateLimiter({ ...config, blockDurationMs: 0 })

      // Exceed limit
      for (let i = 0; i < config.maxRequests; i++) {
        limiter.check(createSource('source-1'))
      }

      const result = limiter.check(createSource('source-1'))
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.blocked).toBe(false)
      }
    })

    it('tracks sources independently', () => {
      const limiter = new RateLimiter(config)

      // Exhaust source-1
      for (let i = 0; i < config.maxRequests; i++) {
        limiter.check(createSource('source-1'))
      }
      expect(limiter.check(createSource('source-1')).allowed).toBe(false)

      // source-2 should still be allowed
      expect(limiter.check(createSource('source-2')).allowed).toBe(true)
    })

    it('returns correct retryAfter when blocked', () => {
      const limiter = new RateLimiter(config)

      // Exceed limit to trigger block
      for (let i = 0; i <= config.maxRequests; i++) {
        limiter.check(createSource('source-1'))
      }

      const result = limiter.check(createSource('source-1'))
      if (!result.allowed) {
        expect(result.retryAfter).toBeGreaterThan(0)
        expect(result.retryAfter).toBeLessThanOrEqual(config.blockDurationMs)
      }
    })

    it('blocks same-IP TLS cipher rotation via IP ceiling', () => {
      const limiter = new RateLimiter(config)

      // Exhaust IP ceiling for 192.168.1.1 using cipher1
      for (let i = 0; i < config.maxRequests; i++) {
        expect(
          limiter.check(
            createSource('192.168.1.1', 'Mozilla/5.0', {
              cipherSuite: 'TLS_AES_256_GCM_SHA384',
              version: 'TLSv1.3',
            }),
          ).allowed,
        ).toBe(true)
      }

      // Rotation attempt with different cipher, same IP — blocked by IP ceiling (soft reject, no penalty)
      const rotated = limiter.check(
        createSource('192.168.1.1', 'Mozilla/5.0', {
          cipherSuite: 'TLS_CHACHA20_POLY1305_SHA256',
          version: 'TLSv1.3',
        }),
      )
      expect(rotated.allowed).toBe(false)
      if (!rotated.allowed) {
        expect(rotated.blocked).toBe(false) // IP ceiling: no penalty block
        expect(rotated.reason).toContain('IP rate ceiling')
      }

      // Original cipher is also blocked (composite block)
      const original = limiter.check(
        createSource('192.168.1.1', 'Mozilla/5.0', {
          cipherSuite: 'TLS_AES_256_GCM_SHA384',
          version: 'TLSv1.3',
        }),
      )
      expect(original.allowed).toBe(false)
    })

    it('blocks same-IP user-agent rotation via IP ceiling', () => {
      const limiter = new RateLimiter(config)

      // Exhaust IP ceiling for 192.168.1.1
      for (let i = 0; i < config.maxRequests; i++) {
        expect(limiter.check(createSource('192.168.1.1', 'Mozilla/5.0')).allowed).toBe(true)
      }

      // UA rotation attempt — blocked by IP ceiling (soft reject)
      const rotated = limiter.check(createSource('192.168.1.1', 'curl/7.68.0'))
      expect(rotated.allowed).toBe(false)
      if (!rotated.allowed) {
        expect(rotated.blocked).toBe(false) // IP ceiling: no penalty block
      }
    })

    it('does not create new composite entries when IP ceiling rejects rotated fingerprints', () => {
      const limiter = new RateLimiter({ ...config, maxSources: 2 })
      const attackerIp = '192.168.77.10'

      // Fill ceiling for attacker IP with one composite fingerprint.
      for (let i = 0; i < config.maxRequests; i++) {
        expect(limiter.check(createSource(attackerIp, 'base-ua')).allowed).toBe(true)
      }

      const sourcesBeforeRotation = limiter.stats.sources
      const evictionsBeforeRotation = limiter.stats.totalEvictions
      expect(sourcesBeforeRotation).toBe(1)

      // Rotate fingerprints on the same IP while ceiling is already exceeded.
      for (let i = 0; i < 8; i++) {
        const rotated = limiter.check(
          createSource(attackerIp, `rotated-ua-${i}`, {
            cipherSuite: 'TLS_AES_256_GCM_SHA384',
            version: 'TLSv1.3',
            alpn: `h2-${i}`,
          }),
        )
        expect(rotated.allowed).toBe(false)
        if (!rotated.allowed) {
          expect(rotated.reason).toContain('IP rate ceiling')
          expect(rotated.blocked).toBe(false)
        }
      }

      expect(limiter.stats.sources).toBe(sourcesBeforeRotation)
      expect(limiter.stats.totalEvictions).toBe(evictionsBeforeRotation)
    })

    it('falls back gracefully when TLS unavailable', () => {
      const limiter = new RateLimiter(config)

      // Use up limit without TLS
      for (let i = 0; i < config.maxRequests; i++) {
        limiter.check(createSource('192.168.1.1', 'curl/7.68.0'))
      }

      // Next request without TLS - should be blocked
      const result = limiter.check(createSource('192.168.1.1', 'curl/7.68.0'))
      expect(result.allowed).toBe(false)
    })

    it('normalizes oversized source components while keeping deterministic and distinct keys', () => {
      const limiter = new RateLimiter({
        ...config,
        maxRequests: 20,
        blockDurationMs: 0,
      })
      const ip = '172.16.0.10'
      const longPrefix = 'ua-'.repeat(1200)

      const longSourceA = createSource(ip, `${longPrefix}A`, {
        cipherSuite: `${'cipher-'.repeat(400)}A`,
        version: `${'tlsv-'.repeat(400)}A`,
        alpn: `${'alpn-'.repeat(400)}A`,
      })
      const longSourceB = createSource(ip, `${longPrefix}B`, {
        cipherSuite: `${'cipher-'.repeat(400)}B`,
        version: `${'tlsv-'.repeat(400)}B`,
        alpn: `${'alpn-'.repeat(400)}B`,
      })

      // Same oversized source should map deterministically to a single composite entry.
      expect(limiter.check(longSourceA).allowed).toBe(true)
      expect(limiter.check(longSourceA).allowed).toBe(true)
      expect(limiter.stats.sources).toBe(1)

      // Distinct oversized tails should still produce distinct composite keys.
      expect(limiter.check(longSourceB).allowed).toBe(true)
      expect(limiter.stats.sources).toBe(2)
    })

    it('keeps raw and truncated component encodings distinct', () => {
      const limiter = new RateLimiter({
        ...config,
        maxRequests: 20,
        blockDurationMs: 0,
      })
      const ip = '172.16.0.20'
      const head = 'H'.repeat(160)
      const tail = 'T'.repeat(80)
      const oversizedUserAgent = `${head}${'x'.repeat(17)}${tail}` // 257 chars
      const rawMimicUserAgent = `${head}|${tail}|len=${oversizedUserAgent.length}`

      const oversized = createSource(ip, oversizedUserAgent, {
        cipherSuite: 'TLS_AES_256_GCM_SHA384',
        version: 'TLSv1.3',
      })
      const rawMimic = createSource(ip, rawMimicUserAgent, {
        cipherSuite: 'TLS_AES_256_GCM_SHA384',
        version: 'TLSv1.3',
      })

      expect(limiter.check(oversized).allowed).toBe(true)
      expect(limiter.check(rawMimic).allowed).toBe(true)
      expect(limiter.stats.sources).toBe(2)
    })
  })

  describe('capacity limits (LRU eviction)', () => {
    it('evicts oldest entry when maxSources is exceeded', () => {
      const smallConfig = { ...config, maxSources: 3 }
      const limiter = new RateLimiter(smallConfig)

      // Insert 3 sources
      limiter.check(createSource('A'))
      limiter.check(createSource('B'))
      limiter.check(createSource('C'))

      expect(limiter.stats.sources).toBe(3)
      expect(limiter.stats.totalEvictions).toBe(0)

      // Insert 4th source -> Evicts A
      limiter.check(createSource('D'))

      expect(limiter.stats.sources).toBe(3)
      expect(limiter.stats.totalEvictions).toBe(1)

      // Verify A is treated as a new entry. It shouldn't be blocked.
      for (let i = 0; i < smallConfig.maxRequests - 1; i++) {
        expect(limiter.check(createSource('A')).allowed).toBe(true)
      }
      expect(limiter.check(createSource('A')).allowed).toBe(true) // Last check should be allowed if A was fresh
    })

    it('evicts oldest IP ceiling entry when IP ceiling reaches capacity', () => {
      const smallConfig = {
        ...config,
        maxSources: 2,
        maxRequests: 1,
        blockDurationMs: 0,
      }
      const limiter = new RateLimiter(smallConfig)

      // Fill both maps to capacity with 2 distinct IPs
      expect(limiter.check(createSource('ip-a')).allowed).toBe(true)
      expect(limiter.check(createSource('ip-b')).allowed).toBe(true)

      // 3rd distinct IP triggers eviction from both composite and IP ceiling maps
      // 3rd distinct IP should evict the oldest entry (`ip-a`) from both maps
      expect(limiter.check(createSource('ip-c')).allowed).toBe(true)

      // If `ip-a` was evicted from the IP ceiling map, it should be treated as fresh
      expect(limiter.check(createSource('ip-a')).allowed).toBe(true)
    })

    it('keeps active rejected IP ceiling entries hot to avoid premature eviction', () => {
      const smallConfig = {
        ...config,
        maxSources: 2,
        maxRequests: 1,
        blockDurationMs: 0,
      }
      const limiter = new RateLimiter(smallConfig)

      expect(limiter.check(createSource('ip-a', 'ua-a1')).allowed).toBe(true)
      expect(limiter.check(createSource('ip-b', 'ua-b1')).allowed).toBe(true)

      // Active reject on ip-a should refresh LRU/lastActivity.
      const rejectedA = limiter.check(createSource('ip-a', 'ua-a2'))
      expect(rejectedA.allowed).toBe(false)
      if (!rejectedA.allowed) {
        expect(rejectedA.reason).toContain('IP rate ceiling')
      }

      // Insert a new IP at capacity => should evict ip-b, not freshly-rejected ip-a.
      expect(limiter.check(createSource('ip-c', 'ua-c1')).allowed).toBe(true)

      // ip-a should still be tracked and rejected within the same window.
      const stillRejectedA = limiter.check(createSource('ip-a', 'ua-a3'))
      expect(stillRejectedA.allowed).toBe(false)

      // ip-b should have been evicted and be treated as fresh.
      expect(limiter.check(createSource('ip-b', 'ua-b2')).allowed).toBe(true)
    })

    it('respects LRU order when evicting', () => {
      const smallConfig = { ...config, maxSources: 3 }
      const limiter = new RateLimiter(smallConfig)

      limiter.check(createSource('A')) // oldest
      limiter.check(createSource('B'))
      limiter.check(createSource('C')) // newest

      // Re-check A -> B is now the oldest
      limiter.check(createSource('A'))

      // Insert D -> Evicts B
      limiter.check(createSource('D'))

      expect(limiter.stats.totalEvictions).toBe(1)

      // Verify B is evicted and treated as new
      for (let i = 0; i < smallConfig.maxRequests - 1; i++) {
        expect(limiter.check(createSource('B')).allowed).toBe(true)
      }
      expect(limiter.check(createSource('B')).allowed).toBe(true)
    })
  })

  describe('reset', () => {
    it('clears rate limit for source', () => {
      const limiter = new RateLimiter(config)

      // Exhaust and block source
      for (let i = 0; i <= config.maxRequests; i++) {
        limiter.check(createSource('source-1'))
      }
      expect(limiter.check(createSource('source-1')).allowed).toBe(false)

      // Reset
      limiter.reset(createSource('source-1'))

      // Should be allowed again
      expect(limiter.check(createSource('source-1')).allowed).toBe(true)
    })

    it('does not affect other sources', () => {
      const limiter = new RateLimiter(config)

      // Use some requests for both sources
      limiter.check(createSource('source-1'))
      limiter.check(createSource('source-2'))

      limiter.reset(createSource('source-1'))

      // source-2 should retain its count
      expect(limiter.stats.sources).toBe(1)
    })
  })

  describe('cleanup', () => {
    it('removes stale entries', () => {
      const limiter = new RateLimiter(config)

      // Create an entry
      limiter.check(createSource('source-1'))
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

      limiter.check(createSource('source-1'))

      // Immediate cleanup should not remove
      const cleaned = limiter.cleanup()
      expect(cleaned).toBe(0)
      expect(limiter.stats.sources).toBe(1)
    })

    it('does not remove blocked entries before expiry', () => {
      const limiter = new RateLimiter(config)

      // Block source
      for (let i = 0; i <= config.maxRequests; i++) {
        limiter.check(createSource('source-1'))
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

      limiter.check(createSource('source-1'))
      limiter.check(createSource('source-2'))
      limiter.check(createSource('source-3'))

      expect(limiter.stats.sources).toBe(3)
    })

    it('tracks blocked sources', () => {
      const limiter = new RateLimiter(config)

      // Block source-1
      for (let i = 0; i <= config.maxRequests; i++) {
        limiter.check(createSource('source-1'))
      }

      expect(limiter.stats.blocked).toBe(1)
    })

    it('tracks total checks', () => {
      const limiter = new RateLimiter(config)

      limiter.check(createSource('source-1'))
      limiter.check(createSource('source-1'))
      limiter.check(createSource('source-2'))

      expect(limiter.stats.totalChecks).toBe(3)
    })

    it('tracks total rejections', () => {
      const limiter = new RateLimiter(config)

      // Use up limit
      for (let i = 0; i < config.maxRequests; i++) {
        limiter.check(createSource('source-1'))
      }

      // These should be rejected
      limiter.check(createSource('source-1'))
      limiter.check(createSource('source-1'))

      expect(limiter.stats.totalRejections).toBe(2)
    })
  })

  describe('createRateLimiter factory', () => {
    it('creates a rate limiter instance', () => {
      const limiter = createRateLimiter(config)
      expect(limiter.check(createSource('test')).allowed).toBe(true)
    })
  })
})
