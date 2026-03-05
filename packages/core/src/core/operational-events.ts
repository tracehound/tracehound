/**
 * Canonical operational event reason taxonomy.
 *
 * Centralizes system.panic reason literals to prevent drift between emitters,
 * validators, and tests.
 */
export const SYSTEM_PANIC_REASONS = Object.freeze({
  HOUND_TIMEOUT_SIGNATURE_PREFIX: 'hound_timeout: signature=',
  HOUND_ERROR_PREFIX: 'hound_error: ',
  SNAPSHOT_WRITE_FAILED: 'snapshot_write_failed',
  SNAPSHOT_CLEANUP_FAILED: 'snapshot_cleanup_failed',
  COORDINATION_INVALID_CONTRACT: 'coordination.invalid_contract',
  COORDINATION_HEALTH_FAILURE: 'coordination.health_failure',
  MEMBRANE_PAYLOAD_EGRESS_BLOCKED: 'membrane.payload_egress_blocked',
} as const)

export function formatHoundTimeoutReason(signature: string): string {
  return `${SYSTEM_PANIC_REASONS.HOUND_TIMEOUT_SIGNATURE_PREFIX}${signature}`
}

export function formatHoundErrorReason(error: string): string {
  return `${SYSTEM_PANIC_REASONS.HOUND_ERROR_PREFIX}${error}`
}
