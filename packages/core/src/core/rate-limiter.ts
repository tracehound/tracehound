/**
 * Rate Limiter - sliding window with per-source tracking and cleanup.
 *
 * SECURITY: Two-tier rate limiting prevents DoS and bucket-rotation bypass.
 *   - Composite fingerprint (IP + UA + TLS): fine-grained tracking with block semantics.
 *   - IP-only ceiling: caps total requests from one IP regardless of how many
 *     distinct fingerprints the sender presents. New composite entries are not
 *     created when the IP ceiling already rejects the request.
 * Memory Safety: TTL-based cleanup prevents memory leaks.
 */

import type { RateLimitConfig } from '../types/config.js'
import { Errors } from '../types/errors.js'
import type { ScentSource } from '../types/scent.js'
import { hash } from '../utils/hash.js'

const MAX_SOURCE_KEY_COMPONENT_LENGTH = 256
const SOURCE_KEY_HEAD_LENGTH = 160
const SOURCE_KEY_TAIL_LENGTH = 80

type NormalizedSourceKeyComponent =
  | { kind: 'raw'; value: string }
  | { kind: 'truncated'; head: string; tail: string; length: number }

/**
 * Bound source key component size to mitigate CPU amplification from oversized headers.
 * Keeps deterministic entropy by preserving head + tail + original length.
 */
function normalizeSourceKeyComponent(value: string | undefined): NormalizedSourceKeyComponent {
  if (value === undefined || value.length === 0) {
    return { kind: 'raw', value: '' }
  }

  if (value.length <= MAX_SOURCE_KEY_COMPONENT_LENGTH) {
    return { kind: 'raw', value }
  }

  const head = value.slice(0, SOURCE_KEY_HEAD_LENGTH)
  const tail = value.slice(value.length - SOURCE_KEY_TAIL_LENGTH)
  return { kind: 'truncated', head, tail, length: value.length }
}

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

interface TimestampWindow {
  values: number[]
  start: number
}

function createTimestampWindow(): TimestampWindow {
  return { values: [], start: 0 }
}

function clearTimestampWindow(window: TimestampWindow): void {
  window.values = []
  window.start = 0
}

function compactTimestampWindow(window: TimestampWindow): void {
  if (window.start === 0) {
    return
  }

  if (window.start >= window.values.length) {
    clearTimestampWindow(window)
    return
  }

  window.values = window.values.slice(window.start)
  window.start = 0
}

function pruneTimestampWindow(
  window: TimestampWindow,
  windowStart: number,
  maxRetainedEntries: number,
): void {
  while (window.start < window.values.length) {
    const timestamp = window.values[window.start]
    if (timestamp === undefined || timestamp > windowStart) {
      break
    }

    window.start += 1
  }

  if (window.start === window.values.length) {
    clearTimestampWindow(window)
    return
  }

  if (window.start >= maxRetainedEntries || window.start * 2 >= window.values.length) {
    compactTimestampWindow(window)
  }
}

function appendTimestampWindow(
  window: TimestampWindow,
  timestamp: number,
  maxRetainedEntries: number,
): void {
  if (window.start >= maxRetainedEntries || window.start * 2 >= window.values.length) {
    compactTimestampWindow(window)
  }

  window.values.push(timestamp)
}

function getTimestampWindowCount(window: TimestampWindow): number {
  return window.values.length - window.start
}

function getTimestampWindowOldest(window: TimestampWindow): number | undefined {
  return window.values[window.start]
}

/**
 * Source tracking entry (composite fingerprint map).
 */
interface SourceEntry {
  /** Request timestamps in current window */
  timestamps: TimestampWindow
  /** If blocked, when block expires */
  blockedUntil: number | null
  /** Last activity timestamp for cleanup */
  lastActivity: number
}

/**
 * IP ceiling entry (IP-only map, no block semantics).
 */
interface IpCeilingEntry {
  /** Request timestamps in current window (allowed requests only) */
  timestamps: TimestampWindow
  /** Last activity timestamp for cleanup */
  lastActivity: number
}

/**
 * Generate composite key from ScentSource for rate limiting.
 * Uses SHA-256 for deterministic entropy.
 *
 * SECURITY:
 * - Hash-based key prevents information leakage in logs.
 * - Component normalization bounds per-check processing for oversized headers.
 */
function generateSourceKey(source: ScentSource): string {
  const components: NormalizedSourceKeyComponent[] = [
    normalizeSourceKeyComponent(source.ip),
    normalizeSourceKeyComponent(source.userAgent),
    normalizeSourceKeyComponent(source.tls?.cipherSuite),
    normalizeSourceKeyComponent(source.tls?.version),
    normalizeSourceKeyComponent(source.tls?.alpn),
  ]
  return hash(JSON.stringify(components))
}

/**
 * Rate limiter interface per RFC-0000.
 */
export interface IRateLimiter {
  /**
   * Check if source is allowed to proceed.
   * @param source - Source identifier with extended entropy
   */
  check(source: ScentSource): RateLimitResult
  /**
   * Reset rate limiting state for a specific composite fingerprint.
   * @param source - Source identifier
   */
  resetSourceFingerprint(source: ScentSource): void
  /**
   * Reset the IP-wide ceiling state for a given IP address.
   * @param ip - IP Address
   */
  resetIpCeiling(ip: string): void
  /**
   * Reset rate limiting state for a source.
   * Used for manual unblocking.
   * @param source - Source identifier
   */
  reset(source: ScentSource): void

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
  /** Total capacity evictions */
  totalEvictions: number
}

/**
 * Sliding window rate limiter implementation.
 *
 * Algorithm:
 * 1. If composite entry exists: evaluate block/window state first
 * 2. Evaluate IP-only ceiling
 * 3. If IP ceiling rejects: return soft rejection (no penalty block)
 * 4. If composite entry does not exist and IP allows: create/evaluate composite entry
 * 5. Record timestamp in both maps and allow
 *
 * Block State:
 * - After maxRequests exceeded, composite entry enters blockDurationMs penalty
 * - During block, all requests rejected with blocked: true
 * - After block expires, source can accumulate requests again
 * - IP ceiling has no block penalty — once the window passes, requests are allowed again
 */
export class RateLimiter implements IRateLimiter {
  private readonly sources = new Map<string, SourceEntry>()
  private readonly ipCeiling = new Map<string, IpCeilingEntry>()
  private readonly config: Required<RateLimitConfig>
  private readonly now: () => number
  private totalChecks = 0
  private totalRejections = 0
  private totalEvictions = 0

  constructor(config: RateLimitConfig, now?: () => number) {
    // eslint-disable-next-line no-restricted-syntax -- intentional bridge: closure defers to global Date.now at call time so vi.useFakeTimers() works regardless of construction order
    this.now = now ?? ((): number => Date.now())
    // Validate config
    if (config.windowMs <= 0) {
      throw Errors.invalidConfigRateLimit('windowMs must be positive')
    }
    if (config.maxRequests <= 0) {
      throw Errors.invalidConfigRateLimit('maxRequests must be positive')
    }
    if (config.blockDurationMs < 0) {
      throw Errors.invalidConfigRateLimit('blockDurationMs cannot be negative')
    }
    if (config.maxSources !== undefined && config.maxSources <= 0) {
      throw Errors.invalidConfigRateLimit('maxSources must be positive')
    }

    this.config = {
      windowMs: config.windowMs,
      maxRequests: config.maxRequests,
      blockDurationMs: config.blockDurationMs,
      maxSources: config.maxSources ?? 100_000,
    }
  }

  check(source: ScentSource): RateLimitResult {
    this.totalChecks++
    const now = this.now()
    const key = generateSourceKey(source)
    const hasCompositeEntry = this.sources.has(key)

    // --- Step 1: Existing composite entry evaluation (preserve block semantics) ---
    if (hasCompositeEntry) {
      const compositeResult = this.evaluateExistingComposite(key, now)
      if (!compositeResult.allowed) {
        this.totalRejections++
        return compositeResult
      }
    }

    // --- Step 2: IP-only ceiling (prevents bucket-rotation bypass via UA/TLS rotation) ---
    const ipResult = this.evaluateIpCeiling(source.ip, now)
    if (!ipResult.allowed) {
      this.totalRejections++
      return ipResult
    }

    // --- Step 3: Create/evaluate composite entry only when IP ceiling allows ---
    if (!hasCompositeEntry) {
      const compositeResult = this.evaluateComposite(key, now)
      if (!compositeResult.allowed) {
        this.totalRejections++
        return compositeResult
      }
    }

    // --- Both checks passed: record timestamps ---
    this.recordCompositeTimestamp(key, now)
    this.recordIpCeiling(source.ip, now)

    return { allowed: true }
  }

  /**
   * Evaluate composite fingerprint entry.
   * Handles LRU eviction, block state, and window count.
   * Does NOT record the request timestamp — caller must call recordCompositeTimestamp.
   */
  private evaluateComposite(key: string, now: number): RateLimitResult {
    let entry = this.sources.get(key)
    if (entry) {
      // LRU: move to back (youngest)
      this.sources.delete(key)
      this.sources.set(key, entry)
    } else {
      // Capacity eviction
      if (this.sources.size >= this.config.maxSources) {
        const oldest = this.sources.keys().next().value
        if (oldest !== undefined) {
          this.sources.delete(oldest)
          this.totalEvictions++
        }
      }
      entry = { timestamps: createTimestampWindow(), blockedUntil: null, lastActivity: now }
      this.sources.set(key, entry)
    }

    return this.evaluateCompositeEntry(entry, now)
  }

  /**
   * Evaluate existing composite fingerprint entry only (no creation).
   * Preserves block state precedence without allocating new keys.
   */
  private evaluateExistingComposite(key: string, now: number): RateLimitResult {
    const entry = this.sources.get(key)
    if (!entry) return { allowed: true }

    // LRU: move to back (youngest)
    this.sources.delete(key)
    this.sources.set(key, entry)

    return this.evaluateCompositeEntry(entry, now)
  }

  /**
   * Shared composite state evaluation logic.
   */
  private evaluateCompositeEntry(entry: SourceEntry, now: number): RateLimitResult {
    entry.lastActivity = now

    // Check block state
    if (entry.blockedUntil !== null) {
      if (now < entry.blockedUntil) {
        return {
          allowed: false,
          blocked: true,
          retryAfter: entry.blockedUntil - now,
          reason: 'Source is blocked due to rate limit violation',
        }
      }
      // Block expired
      entry.blockedUntil = null
      clearTimestampWindow(entry.timestamps)
    }

    // Remove timestamps outside current window
    const windowStart = now - this.config.windowMs
    pruneTimestampWindow(entry.timestamps, windowStart, this.config.maxRequests)

    // Check if limit exceeded
    if (getTimestampWindowCount(entry.timestamps) >= this.config.maxRequests) {
      if (this.config.blockDurationMs > 0) {
        entry.blockedUntil = now + this.config.blockDurationMs
        return {
          allowed: false,
          blocked: true,
          retryAfter: this.config.blockDurationMs,
          reason: 'Rate limit exceeded, source blocked',
        }
      }

      const oldest = getTimestampWindowOldest(entry.timestamps)
      const retryAfter =
        oldest !== undefined ? oldest + this.config.windowMs - now : this.config.windowMs
      return {
        allowed: false,
        blocked: false,
        retryAfter: Math.max(0, retryAfter),
        reason: 'Rate limit exceeded within sliding window',
      }
    }

    return { allowed: true }
  }

  /**
   * Record an allowed request in the composite fingerprint map.
   * Must be called only after evaluateComposite returns allowed.
   */
  private recordCompositeTimestamp(key: string, now: number): void {
    const entry = this.sources.get(key)
    if (entry !== undefined) {
      appendTimestampWindow(entry.timestamps, now, this.config.maxRequests)
    }
  }

  /**
   * Evaluate IP-only ceiling (read-only, no state changes).
   * Returns soft rejection (blocked: false) if IP has hit the ceiling.
   */
  private evaluateIpCeiling(ip: string, now: number): RateLimitResult {
    const entry = this.ipCeiling.get(ip)
    if (!entry) return { allowed: true }

    // Treat reads as activity: keep hot entries fresh in LRU and cleanup horizon.
    this.ipCeiling.delete(ip)
    this.ipCeiling.set(ip, entry)
    entry.lastActivity = now

    const windowStart = now - this.config.windowMs
    pruneTimestampWindow(entry.timestamps, windowStart, this.config.maxRequests)

    if (getTimestampWindowCount(entry.timestamps) >= this.config.maxRequests) {
      const oldestInWindow = getTimestampWindowOldest(entry.timestamps)
      const retryAfter =
        oldestInWindow !== undefined
          ? oldestInWindow + this.config.windowMs - now
          : this.config.windowMs
      return {
        allowed: false,
        blocked: false,
        retryAfter: Math.max(0, retryAfter),
        reason: 'IP rate ceiling exceeded',
      }
    }

    return { allowed: true }
  }

  /**
   * Record an allowed request in the IP ceiling map.
   * Must be called only after evaluateIpCeiling returns allowed.
   */
  private recordIpCeiling(ip: string, now: number): void {
    let entry = this.ipCeiling.get(ip)
    if (entry) {
      // LRU: move to back
      this.ipCeiling.delete(ip)
      this.ipCeiling.set(ip, entry)
    } else {
      if (this.ipCeiling.size >= this.config.maxSources) {
        const oldest = this.ipCeiling.keys().next().value
        if (oldest !== undefined) this.ipCeiling.delete(oldest)
        // Not counted in totalEvictions (internal ceiling map)
      }
      entry = { timestamps: createTimestampWindow(), lastActivity: now }
      this.ipCeiling.set(ip, entry)
    }
    entry.lastActivity = now
    const windowStart = now - this.config.windowMs
    pruneTimestampWindow(entry.timestamps, windowStart, this.config.maxRequests)
    appendTimestampWindow(entry.timestamps, now, this.config.maxRequests)
  }

  /**
   * Reset rate limiting state for a specific composite fingerprint.
   *
   * This only clears the fine-grained per-source tracking keyed by the
   * composite fingerprint (IP + UA + TLS, etc). It does NOT modify the
   * IP-wide ceiling.
   */
  resetSourceFingerprint(source: ScentSource): void {
    this.sources.delete(generateSourceKey(source))
  }
  /**
   * Reset the IP-wide ceiling state for a given IP address.
   *
   * This only clears the aggregate IP ceiling counter. It does NOT clear any
   * composite fingerprint entries associated with the IP.
   */
  resetIpCeiling(ip: string): void {
    this.ipCeiling.delete(ip)
  }
  /**
   * Reset rate limiting state for a source.
   *
   * NOTE:
   * - This is a convenience method that resets BOTH:
   *   - the composite fingerprint entry for the provided source, and
   *   - the IP ceiling for source.ip (affecting all fingerprints from that IP).
   * - Callers that need granular control should prefer:
   *   - resetSourceFingerprint(source) to clear only the composite entry, or
   *   - resetIpCeiling(source.ip) to clear only the IP ceiling.
   */
  reset(source: ScentSource): void {
    this.resetSourceFingerprint(source)
    this.resetIpCeiling(source.ip)
  }

  cleanup(): number {
    const now = this.now()
    const staleThreshold = now - this.config.windowMs - this.config.blockDurationMs

    let cleaned = 0
    for (const [key, entry] of this.sources) {
      const isExpiredBlock = entry.blockedUntil !== null && entry.blockedUntil < now
      const isStale = entry.lastActivity < staleThreshold

      if (isStale && (entry.blockedUntil === null || isExpiredBlock)) {
        this.sources.delete(key)
        cleaned++
      }
    }

    // Clean stale IP ceiling entries (not counted in cleaned)
    for (const [ip, entry] of this.ipCeiling) {
      if (entry.lastActivity < staleThreshold) {
        this.ipCeiling.delete(ip)
      }
    }

    return cleaned
  }

  get stats(): RateLimiterStats {
    let blocked = 0
    const now = this.now()

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
      totalEvictions: this.totalEvictions,
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
export function createRateLimiter(config: RateLimitConfig, now?: () => number): IRateLimiter {
  return new RateLimiter(config, now)
}
