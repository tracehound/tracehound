/**
 * Intercept result types and type guards.
 */

import type { TracehoundError } from './errors.js'
import type { EvidenceHandle } from './evidence.js'

/**
 * Result of an intercept operation.
 * Discriminated union for exhaustive handling.
 */
export type InterceptResult =
  | { status: 'clean' }
  | { status: 'rate_limited'; retryAfter: number }
  | { status: 'payload_too_large'; limit: number }
  | { status: 'ignored'; signature: string }
  | { status: 'quarantined'; handle: EvidenceHandle }
  | { status: 'error'; error: TracehoundError }

/**
 * Type guard for quarantined result.
 */
export function isQuarantined(
  result: InterceptResult
): result is { status: 'quarantined'; handle: EvidenceHandle } {
  return result.status === 'quarantined'
}

/**
 * Type guard for error result.
 */
export function isError(
  result: InterceptResult
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
  result: InterceptResult
): result is { status: 'rate_limited'; retryAfter: number } {
  return result.status === 'rate_limited'
}

/**
 * Type guard for ignored result (duplicate signature).
 */
export function isIgnored(
  result: InterceptResult
): result is { status: 'ignored'; signature: string } {
  return result.status === 'ignored'
}
