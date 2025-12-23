/**
 * Rate Limiter - sliding window with per-source tracking and cleanup.
 *
 * SECURITY: Prevents pool exhaustion DoS by early rejection.
 * Memory Safety: TTL-based cleanup prevents memory leaks.
 */

import type { RateLimitConfig } from '../types/config.js'

/**
 * Result of a rate limit check.
 */
export type RateLimitResult =
  | { allowed: true }
  | {
      allowed: false
      /** True if source is in block penalty period */
      blocked: boolean
      /** Milliseconds until source can retry */
      retryAfter: number
      /** Human-readable reason */
      reason: string
    }

/**
 * Source tracking entry.
 */
interface SourceEntry {
  /** Request timestamps in current window */
  timestamps: number[]
  /** If blocked, when block expires */
  blockedUntil: number | null
  /** Last activity timestamp for cleanup */
  lastActivity: number
}

/**
 * Rate limiter interface per RFC-0000.
 */
export interface IRateLimiter {
  /**
   * Check if source is allowed to proceed.
   * @param source - Source identifier (IP, API key, etc.)
   */
  check(source: string): RateLimitResult

  /**
   * Reset rate limit for a specific source.
   * Used for manual unblocking.
   * @param source - Source identifier
   */
  reset(source: string): void

  /**
   * Clean up stale entries to prevent memory leaks.
   * Should be called periodically.
   * @returns Number of entries cleaned
   */
  cleanup(): number

  /**
   * Get current statistics.
   */
  readonly stats: RateLimiterStats
}

/**
 * Rate limiter statistics.
 */
export interface RateLimiterStats {
  /** Total tracked sources */
  sources: number
  /** Currently blocked sources */
  blocked: number
  /** Total checks performed */
  totalChecks: number
  /** Total rejections */
  totalRejections: number
}

/**
 * Sliding window rate limiter implementation.
 *
 * Algorithm:
 * 1. Maintain list of request timestamps per source
 * 2. On check, remove timestamps outside window
 * 3. If count >= maxRequests, reject and optionally block
 * 4. Otherwise, record timestamp and allow
 *
 * Block State:
 * - After maxRequests exceeded, source enters blockDurationMs penalty
 * - During block, all requests rejected with blocked: true
 * - After block expires, source can accumulate requests again
 */
export class RateLimiter implements IRateLimiter {
  private readonly sources = new Map<string, SourceEntry>()
  private readonly config: Required<RateLimitConfig>
  private totalChecks = 0
  private totalRejections = 0

  constructor(config: RateLimitConfig) {
    // Validate config
    if (config.windowMs <= 0) {
      throw new Error('windowMs must be positive')
    }
    if (config.maxRequests <= 0) {
      throw new Error('maxRequests must be positive')
    }
    if (config.blockDurationMs < 0) {
      throw new Error('blockDurationMs cannot be negative')
    }

    this.config = {
      windowMs: config.windowMs,
      maxRequests: config.maxRequests,
      blockDurationMs: config.blockDurationMs,
    }
  }

  check(source: string): RateLimitResult {
    this.totalChecks++
    const now = Date.now()

    // Get or create source entry
    let entry = this.sources.get(source)
    if (!entry) {
      entry = {
        timestamps: [],
        blockedUntil: null,
        lastActivity: now,
      }
      this.sources.set(source, entry)
    }

    // Update last activity
    entry.lastActivity = now

    // Check if currently blocked
    if (entry.blockedUntil !== null) {
      if (now < entry.blockedUntil) {
        // Still blocked
        this.totalRejections++
        return {
          allowed: false,
          blocked: true,
          retryAfter: entry.blockedUntil - now,
          reason: 'Source is blocked due to rate limit violation',
        }
      } else {
        // Block expired, clear it
        entry.blockedUntil = null
        entry.timestamps = []
      }
    }

    // Remove timestamps outside current window
    const windowStart = now - this.config.windowMs
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart)

    // Check if limit exceeded
    if (entry.timestamps.length >= this.config.maxRequests) {
      this.totalRejections++

      // Apply block if configured
      if (this.config.blockDurationMs > 0) {
        entry.blockedUntil = now + this.config.blockDurationMs
        return {
          allowed: false,
          blocked: true,
          retryAfter: this.config.blockDurationMs,
          reason: 'Rate limit exceeded, source blocked',
        }
      }

      // No block, just sliding window rejection
      const oldestInWindow = entry.timestamps[0]
      // Defensive check (should never happen since length >= maxRequests)
      const retryAfter =
        oldestInWindow !== undefined
          ? oldestInWindow + this.config.windowMs - now
          : this.config.windowMs

      return {
        allowed: false,
        blocked: false,
        retryAfter: Math.max(0, retryAfter),
        reason: 'Rate limit exceeded within sliding window',
      }
    }

    // Allow and record timestamp
    entry.timestamps.push(now)
    return { allowed: true }
  }

  reset(source: string): void {
    this.sources.delete(source)
  }

  cleanup(): number {
    const now = Date.now()
    // Stale threshold: no activity for window + block duration
    const staleThreshold = now - this.config.windowMs - this.config.blockDurationMs

    let cleaned = 0
    for (const [source, entry] of this.sources) {
      // Remove if:
      // 1. Not blocked AND last activity older than stale threshold
      // 2. OR blocked but block already expired AND stale
      const isExpiredBlock = entry.blockedUntil !== null && entry.blockedUntil < now
      const isStale = entry.lastActivity < staleThreshold

      if (isStale && (entry.blockedUntil === null || isExpiredBlock)) {
        this.sources.delete(source)
        cleaned++
      }
    }

    return cleaned
  }

  get stats(): RateLimiterStats {
    let blocked = 0
    const now = Date.now()

    for (const entry of this.sources.values()) {
      if (entry.blockedUntil !== null && entry.blockedUntil > now) {
        blocked++
      }
    }

    return {
      sources: this.sources.size,
      blocked,
      totalChecks: this.totalChecks,
      totalRejections: this.totalRejections,
    }
  }
}

/**
 * Create a rate limiter instance.
 * Factory function for end users.
 *
 * @param config - Rate limit configuration
 * @returns Rate limiter instance
 */
export function createRateLimiter(config: RateLimitConfig): IRateLimiter {
  return new RateLimiter(config)
}
