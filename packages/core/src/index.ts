/**
 * @tracehound/core
 *
 * Security buffer system with immune system architecture.
 */

// Types
export type {
  AlertConfig,
  AuditConfig,
  ColdStorageConfig,
  ErrorState,
  EvacuateRecord,
  EvidenceHandle,
  HoundConfig,
  InterceptResult,
  JsonPrimitive,
  JsonSerializable,
  NeutralizationRecord,
  PurgeRecord,
  QuarantineConfig,
  RateLimitConfig,
  RuntimeConfig,
  Scent,
  SchedulerConfig,
  Severity,
  Threat,
  ThreatCategory,
  ThreatInput,
  TracehoundConfig,
  TracehoundError,
} from './types/index.js'

// Config
export { DEFAULT_CONFIG, mergeWithDefaults } from './types/index.js'

// Errors
export { Errors, createError } from './types/index.js'

// Result type guards
export { isClean, isError, isIgnored, isQuarantined, isRateLimited } from './types/index.js'

// Signature
export { generateSignature, validateSignature } from './types/index.js'

// Utils
export { hash, hashBuffer } from './utils/hash.js'
export { generateSecureId, isValidSecureId } from './utils/id.js'
export { serialize } from './utils/serialize.js'
