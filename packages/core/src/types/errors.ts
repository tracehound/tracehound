/**
 * Tracehound error handling.
 *
 * Error codes are organized by domain:
 * - CONFIG_*     : Configuration validation errors
 * - SCENT_*      : Scent/payload validation errors
 * - AGENT_*      : Agent processing errors
 * - QUARANTINE_* : Quarantine operations
 * - EVIDENCE_*   : Evidence lifecycle
 * - CODEC_*      : Encoding/decoding errors
 * - COLD_*       : Cold storage errors
 * - PROCESS_*    : Hound process errors
 * - RATE_*       : Rate limiting
 * - RUNTIME_*    : Runtime environment
 */

// ─────────────────────────────────────────────────────────────────────────────
// Error States (domains)
// ─────────────────────────────────────────────────────────────────────────────

export type ErrorState =
  | 'config'
  | 'scent'
  | 'agent'
  | 'quarantine'
  | 'evidence'
  | 'codec'
  | 'cold_storage'
  | 'process'
  | 'ratelimit'
  | 'runtime'
  | 'scheduler'

// ─────────────────────────────────────────────────────────────────────────────
// Error Interface
// ─────────────────────────────────────────────────────────────────────────────

/** Tracehound error interface */
export interface TracehoundError {
  /** Component/domain that generated the error */
  state: ErrorState
  /** Error code (DOMAIN_SPECIFIC_ERROR format) */
  code: string
  /** Human-readable message */
  message: string
  /** Additional context for debugging */
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

// ─────────────────────────────────────────────────────────────────────────────
// Pre-defined Error Factories
// ─────────────────────────────────────────────────────────────────────────────

export const Errors = {
  // ─────────────────────────────────────────────────────────────────────────
  // Config Errors
  // ─────────────────────────────────────────────────────────────────────────

  invalidConfigQuarantine: (issue: string) =>
    createError('config', 'CONFIG_QUARANTINE_INVALID', `Invalid quarantine config: ${issue}`, {
      context: { issue },
      recoverable: false,
    }),

  invalidConfigRateLimit: (issue: string) =>
    createError('config', 'CONFIG_RATELIMIT_INVALID', `Invalid rate limit config: ${issue}`, {
      context: { issue },
      recoverable: false,
    }),

  invalidConfigAgent: (issue: string) =>
    createError('config', 'CONFIG_AGENT_INVALID', `Invalid agent config: ${issue}`, {
      context: { issue },
      recoverable: false,
    }),

  invalidConfigScheduler: (issue: string) =>
    createError('config', 'CONFIG_SCHEDULER_INVALID', `Invalid scheduler config: ${issue}`, {
      context: { issue },
      recoverable: false,
    }),

  // ─────────────────────────────────────────────────────────────────────────
  // Scent Errors
  // ─────────────────────────────────────────────────────────────────────────

  scentPayloadInvalid: (reason: string) =>
    createError('scent', 'SCENT_PAYLOAD_INVALID', `Invalid scent payload: ${reason}`, {
      context: { reason },
      recoverable: false,
    }),

  scentSourceMissing: () =>
    createError('scent', 'SCENT_SOURCE_MISSING', 'Scent source is required', {
      recoverable: false,
    }),

  scentIdInvalid: (id: string) =>
    createError('scent', 'SCENT_ID_INVALID', `Invalid scent ID format: ${id}`, {
      context: { id },
      recoverable: false,
    }),

  // ─────────────────────────────────────────────────────────────────────────
  // Agent Errors
  // ─────────────────────────────────────────────────────────────────────────

  payloadTooLarge: (size: number, limit: number) =>
    createError('agent', 'AGENT_PAYLOAD_TOO_LARGE', `Payload size ${size} exceeds limit ${limit}`, {
      context: { size, limit },
      recoverable: false,
    }),

  serializationFailed: (reason: string) =>
    createError('agent', 'AGENT_SERIALIZATION_FAILED', `Failed to serialize: ${reason}`, {
      context: { reason },
      recoverable: false,
    }),

  interceptFailed: (reason: string) =>
    createError('agent', 'AGENT_INTERCEPT_FAILED', `Intercept failed: ${reason}`, {
      context: { reason },
      recoverable: true,
    }),

  // ─────────────────────────────────────────────────────────────────────────
  // Quarantine Errors
  // ─────────────────────────────────────────────────────────────────────────

  quarantineFull: (count: number, maxCount: number) =>
    createError('quarantine', 'QUARANTINE_FULL', `Quarantine at capacity: ${count}/${maxCount}`, {
      context: { count, maxCount },
      recoverable: false,
    }),

  quarantineEvictFailed: (reason: string) =>
    createError('quarantine', 'QUARANTINE_EVICT_FAILED', `Eviction failed: ${reason}`, {
      context: { reason },
      recoverable: false,
    }),

  // ─────────────────────────────────────────────────────────────────────────
  // Evidence Errors
  // ─────────────────────────────────────────────────────────────────────────

  evidenceAlreadyDisposed: (signature: string) =>
    createError('evidence', 'EVIDENCE_DISPOSED', `Evidence ${signature} already disposed`, {
      context: { signature },
      recoverable: false,
    }),

  evidenceTransferFailed: (signature: string) =>
    createError(
      'evidence',
      'EVIDENCE_TRANSFER_FAILED',
      `Failed to transfer evidence ${signature}`,
      {
        context: { signature },
        recoverable: false,
      }
    ),

  evidenceEmpty: () =>
    createError('evidence', 'EVIDENCE_EMPTY', 'Evidence bytes cannot be empty', {
      recoverable: false,
    }),

  evidenceInvalidBytes: () =>
    createError('evidence', 'EVIDENCE_INVALID_BYTES', 'Evidence bytes must be ArrayBuffer', {
      recoverable: false,
    }),

  evidenceHashMismatch: (expected: string, actual: string) =>
    createError(
      'evidence',
      'EVIDENCE_HASH_MISMATCH',
      `Hash mismatch: expected ${expected}, got ${actual}`,
      {
        context: { expected, actual },
        recoverable: false,
      }
    ),

  // ─────────────────────────────────────────────────────────────────────────
  // Codec Errors
  // ─────────────────────────────────────────────────────────────────────────

  codecEncodeFailed: (reason: string) =>
    createError('codec', 'CODEC_ENCODE_FAILED', `Encoding failed: ${reason}`, {
      context: { reason },
      recoverable: false,
    }),

  codecDecodeFailed: (reason: string) =>
    createError('codec', 'CODEC_DECODE_FAILED', `Decoding failed: ${reason}`, {
      context: { reason },
      recoverable: false,
    }),

  codecIntegrityFailed: () =>
    createError('codec', 'CODEC_INTEGRITY_FAILED', 'Integrity verification failed', {
      recoverable: false,
    }),

  // ─────────────────────────────────────────────────────────────────────────
  // Cold Storage Errors
  // ─────────────────────────────────────────────────────────────────────────

  coldStorageWriteFailed: (id: string, reason: string) =>
    createError('cold_storage', 'COLD_WRITE_FAILED', `Failed to write ${id}: ${reason}`, {
      context: { id, reason },
      recoverable: true,
    }),

  coldStorageReadFailed: (id: string, reason: string) =>
    createError('cold_storage', 'COLD_READ_FAILED', `Failed to read ${id}: ${reason}`, {
      context: { id, reason },
      recoverable: true,
    }),

  coldStorageNotFound: (id: string) =>
    createError('cold_storage', 'COLD_NOT_FOUND', `Evidence ${id} not found in cold storage`, {
      context: { id },
      recoverable: false,
    }),

  coldStorageUnavailable: () =>
    createError('cold_storage', 'COLD_UNAVAILABLE', 'Cold storage is unavailable', {
      recoverable: true,
    }),

  // ─────────────────────────────────────────────────────────────────────────
  // Process Errors
  // ─────────────────────────────────────────────────────────────────────────

  processSpawnFailed: (reason: string) =>
    createError('process', 'PROCESS_SPAWN_FAILED', `Failed to spawn process: ${reason}`, {
      context: { reason },
      recoverable: true,
    }),

  processTimeout: (houndId: string, elapsed: number) =>
    createError('process', 'PROCESS_TIMEOUT', `Process ${houndId} timed out after ${elapsed}ms`, {
      context: { houndId, elapsed },
      recoverable: false,
    }),

  processCrashed: (houndId: string, exitCode: number) =>
    createError('process', 'PROCESS_CRASHED', `Process ${houndId} crashed with code ${exitCode}`, {
      context: { houndId, exitCode },
      recoverable: true,
    }),

  processPoolExhausted: (action: string) =>
    createError('process', 'PROCESS_POOL_EXHAUSTED', `Process pool exhausted, action: ${action}`, {
      context: { action },
      recoverable: true,
    }),

  // ─────────────────────────────────────────────────────────────────────────
  // Rate Limit Errors
  // ─────────────────────────────────────────────────────────────────────────

  rateLimited: (source: string, retryAfter: number) =>
    createError('ratelimit', 'RATE_LIMITED', `Source ${source} rate limited`, {
      context: { source, retryAfter },
      recoverable: true,
    }),

  rateSourceBlocked: (source: string, until: number) =>
    createError('ratelimit', 'RATE_SOURCE_BLOCKED', `Source ${source} blocked until ${until}`, {
      context: { source, until },
      recoverable: true,
    }),

  // ─────────────────────────────────────────────────────────────────────────
  // Runtime Errors
  // ─────────────────────────────────────────────────────────────────────────

  runtimeFlagMissing: (flag: string) =>
    createError('runtime', 'RUNTIME_FLAG_MISSING', `Required runtime flag missing: ${flag}`, {
      context: { flag },
      recoverable: false,
    }),

  runtimeIntrinsicsNotFrozen: () =>
    createError('runtime', 'RUNTIME_INTRINSICS_NOT_FROZEN', 'Intrinsics are not frozen', {
      recoverable: false,
    }),

  // ─────────────────────────────────────────────────────────────────────────
  // Scheduler Errors
  // ─────────────────────────────────────────────────────────────────────────

  schedulerTaskFailed: (taskId: string, reason: string) =>
    createError('scheduler', 'SCHEDULER_TASK_FAILED', `Task ${taskId} failed: ${reason}`, {
      context: { taskId, reason },
      recoverable: true,
    }),

  schedulerAlreadyRunning: () =>
    createError('scheduler', 'SCHEDULER_ALREADY_RUNNING', 'Scheduler is already running', {
      recoverable: false,
    }),

  // ─────────────────────────────────────────────────────────────────────────
  // Legacy aliases (for backward compatibility)
  // ─────────────────────────────────────────────────────────────────────────

  /** @deprecated Use processTimeout */
  houndTimeout: (houndId: string, elapsed: number) =>
    createError('process', 'PROCESS_TIMEOUT', `Hound ${houndId} timed out`, {
      context: { houndId, elapsed },
      recoverable: false,
    }),

  /** @deprecated Use evidenceHashMismatch */
  hashMismatch: (expected: string, actual: string) =>
    createError(
      'evidence',
      'EVIDENCE_HASH_MISMATCH',
      `Hash mismatch: expected ${expected}, got ${actual}`,
      {
        context: { expected, actual },
        recoverable: false,
      }
    ),

  /** @deprecated Use evidenceInvalidBytes */
  invalidBytesType: () =>
    createError('evidence', 'EVIDENCE_INVALID_BYTES', 'Evidence bytes must be ArrayBuffer', {
      recoverable: false,
    }),

  /** @deprecated Use evidenceEmpty */
  emptyEvidence: () =>
    createError('evidence', 'EVIDENCE_EMPTY', 'Evidence bytes cannot be empty', {
      recoverable: false,
    }),
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Error Code Constants (for programmatic matching)
// ─────────────────────────────────────────────────────────────────────────────

export const ErrorCodes = {
  // Config
  CONFIG_QUARANTINE_INVALID: 'CONFIG_QUARANTINE_INVALID',
  CONFIG_RATELIMIT_INVALID: 'CONFIG_RATELIMIT_INVALID',
  CONFIG_AGENT_INVALID: 'CONFIG_AGENT_INVALID',
  CONFIG_SCHEDULER_INVALID: 'CONFIG_SCHEDULER_INVALID',

  // Scent
  SCENT_PAYLOAD_INVALID: 'SCENT_PAYLOAD_INVALID',
  SCENT_SOURCE_MISSING: 'SCENT_SOURCE_MISSING',
  SCENT_ID_INVALID: 'SCENT_ID_INVALID',

  // Agent
  AGENT_PAYLOAD_TOO_LARGE: 'AGENT_PAYLOAD_TOO_LARGE',
  AGENT_SERIALIZATION_FAILED: 'AGENT_SERIALIZATION_FAILED',
  AGENT_INTERCEPT_FAILED: 'AGENT_INTERCEPT_FAILED',

  // Quarantine
  QUARANTINE_FULL: 'QUARANTINE_FULL',
  QUARANTINE_EVICT_FAILED: 'QUARANTINE_EVICT_FAILED',

  // Evidence
  EVIDENCE_DISPOSED: 'EVIDENCE_DISPOSED',
  EVIDENCE_TRANSFER_FAILED: 'EVIDENCE_TRANSFER_FAILED',
  EVIDENCE_EMPTY: 'EVIDENCE_EMPTY',
  EVIDENCE_INVALID_BYTES: 'EVIDENCE_INVALID_BYTES',
  EVIDENCE_HASH_MISMATCH: 'EVIDENCE_HASH_MISMATCH',

  // Codec
  CODEC_ENCODE_FAILED: 'CODEC_ENCODE_FAILED',
  CODEC_DECODE_FAILED: 'CODEC_DECODE_FAILED',
  CODEC_INTEGRITY_FAILED: 'CODEC_INTEGRITY_FAILED',

  // Cold Storage
  COLD_WRITE_FAILED: 'COLD_WRITE_FAILED',
  COLD_READ_FAILED: 'COLD_READ_FAILED',
  COLD_NOT_FOUND: 'COLD_NOT_FOUND',
  COLD_UNAVAILABLE: 'COLD_UNAVAILABLE',

  // Process
  PROCESS_SPAWN_FAILED: 'PROCESS_SPAWN_FAILED',
  PROCESS_TIMEOUT: 'PROCESS_TIMEOUT',
  PROCESS_CRASHED: 'PROCESS_CRASHED',
  PROCESS_POOL_EXHAUSTED: 'PROCESS_POOL_EXHAUSTED',

  // Rate Limit
  RATE_LIMITED: 'RATE_LIMITED',
  RATE_SOURCE_BLOCKED: 'RATE_SOURCE_BLOCKED',

  // Runtime
  RUNTIME_FLAG_MISSING: 'RUNTIME_FLAG_MISSING',
  RUNTIME_INTRINSICS_NOT_FROZEN: 'RUNTIME_INTRINSICS_NOT_FROZEN',

  // Scheduler
  SCHEDULER_TASK_FAILED: 'SCHEDULER_TASK_FAILED',
  SCHEDULER_ALREADY_RUNNING: 'SCHEDULER_ALREADY_RUNNING',
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]
