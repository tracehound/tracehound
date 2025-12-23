/**
 * Tracehound error handling.
 */

/** Error states */
export type ErrorState = 'quarantine' | 'hound' | 'agent' | 'scheduler' | 'ratelimit'

/** Tracehound error interface */
export interface TracehoundError {
  /** Component that generated the error */
  state: ErrorState
  /** Error code */
  code: string
  /** Human-readable message */
  message: string
  /** Additional context */
  context?: unknown
  /** Can the operation be retried */
  recoverable: boolean
}

/**
 * Create a TracehoundError.
 */
export function createError(
  state: ErrorState,
  code: string,
  message: string,
  options?: { context?: unknown; recoverable?: boolean }
): TracehoundError {
  return {
    state,
    code,
    message,
    context: options?.context,
    recoverable: options?.recoverable ?? true,
  }
}

/** Pre-defined error factories */
export const Errors = {
  payloadTooLarge: (size: number, limit: number) =>
    createError('agent', 'PAYLOAD_TOO_LARGE', `Payload size ${size} exceeds limit ${limit}`, {
      context: { size, limit },
      recoverable: false,
    }),

  rateLimited: (source: string, retryAfter: number) =>
    createError('ratelimit', 'RATE_LIMITED', `Source ${source} rate limited`, {
      context: { source, retryAfter },
      recoverable: true,
    }),

  quarantineFull: (count: number, maxCount: number) =>
    createError('quarantine', 'QUARANTINE_FULL', `Quarantine at capacity: ${count}/${maxCount}`, {
      context: { count, maxCount },
      recoverable: false,
    }),

  houndTimeout: (houndId: string, elapsed: number) =>
    createError('hound', 'HOUND_TIMEOUT', `Hound ${houndId} timed out`, {
      context: { houndId, elapsed },
      recoverable: false,
    }),

  serializationFailed: (reason: string) =>
    createError('agent', 'SERIALIZATION_FAILED', `Failed to serialize: ${reason}`, {
      context: { reason },
      recoverable: false,
    }),

  runtimeFlagMissing: (flag: string) =>
    createError('agent', 'RUNTIME_FLAG_MISSING', `Required runtime flag missing: ${flag}`, {
      context: { flag },
      recoverable: false,
    }),

  evidenceAlreadyDisposed: (signature: string) =>
    createError('quarantine', 'EVIDENCE_DISPOSED', `Evidence ${signature} already disposed`, {
      context: { signature },
      recoverable: false,
    }),

  hashMismatch: (expected: string, actual: string) =>
    createError(
      'quarantine',
      'HASH_MISMATCH',
      `Hash mismatch: expected ${expected}, got ${actual}`,
      {
        context: { expected, actual },
        recoverable: false,
      }
    ),

  invalidBytesType: () =>
    createError('quarantine', 'INVALID_BYTES_TYPE', 'Evidence bytes must be ArrayBuffer', {
      recoverable: false,
    }),

  emptyEvidence: () =>
    createError('quarantine', 'EMPTY_EVIDENCE', 'Evidence bytes cannot be empty', {
      recoverable: false,
    }),
} as const
