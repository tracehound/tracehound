/**
 * Intercept result types and type guards.
 */

import type { Severity } from './common.js'
import type { TracehoundError } from './errors.js'
import type { ScentSource } from './scent.js'

/**
 * Runtime-safe quarantine handle.
 *
 * Membrane policy:
 * - Exposes metadata only
 * - Rejects direct payload egress attempts (`bytes` / `transfer`)
 * - Rejects forensic lifecycle operations from runtime path
 */
export interface RuntimeEvidenceHandle {
  /** Membrane marker for explicit runtime contract checks. */
  readonly membrane: 'metadata_only'
  /** Encoded evidence size in bytes. */
  readonly size: number
  /** Content hash (SHA-256). */
  readonly hash: string
  /** Threat signature. */
  readonly signature: string
  /** Capture timestamp. */
  readonly captured: number
  /** Threat severity. */
  readonly severity: Severity
  /** Whether underlying evidence has been disposed. */
  readonly disposed: boolean
  /** Source metadata for forensic enrichment. */
  readonly source: ScentSource

  /**
   * Always rejected in runtime membrane path.
   */
  readonly bytes: never

  /**
   * Always rejected in runtime membrane path.
   */
  transfer(): never

  /**
   * Always rejected in runtime membrane path.
   */
  neutralize(previousHash: string): never

  /**
   * Always rejected in runtime membrane path.
   */
  evacuate(destination: string): never
}

/**
 * Result of an intercept operation.
 * Discriminated union for exhaustive handling.
 */
export type InterceptResult =
  | { status: 'clean' }
  | { status: 'rate_limited'; retryAfter: number }
  | { status: 'payload_too_large'; limit: number }
  | { status: 'ignored'; signature: string }
  | { status: 'quarantined'; handle: RuntimeEvidenceHandle }
  | { status: 'error'; error: TracehoundError }

/**
 * Type guard for quarantined result.
 */
export function isQuarantined(
  result: InterceptResult,
): result is { status: 'quarantined'; handle: RuntimeEvidenceHandle } {
  return result.status === 'quarantined'
}

/**
 * Type guard for error result.
 */
export function isError(
  result: InterceptResult,
): result is { status: 'error'; error: TracehoundError } {
  return result.status === 'error'
}

/**
 * Type guard for clean result.
 */
export function isClean(result: InterceptResult): result is { status: 'clean' } {
  return result.status === 'clean'
}

/**
 * Type guard for rate limited result.
 */
export function isRateLimited(
  result: InterceptResult,
): result is { status: 'rate_limited'; retryAfter: number } {
  return result.status === 'rate_limited'
}

/**
 * Type guard for ignored result (duplicate signature).
 */
export function isIgnored(
  result: InterceptResult,
): result is { status: 'ignored'; signature: string } {
  return result.status === 'ignored'
}
