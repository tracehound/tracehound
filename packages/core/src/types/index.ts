/**
 * Type re-exports.
 */

export type { JsonPrimitive, JsonSerializable, Severity } from './common.js'
export { DEFAULT_CONFIG, mergeWithDefaults } from './config.js'
export type {
  AlertConfig,
  AuditConfig,
  ColdStorageConfig,
  HoundConfig,
  QuarantineConfig,
  RateLimitConfig,
  RuntimeConfig,
  SchedulerConfig,
  TracehoundConfig,
} from './config.js'
export { Errors, createError } from './errors.js'
export type { ErrorState, TracehoundError } from './errors.js'
export type {
  EvacuateRecord,
  EvidenceHandle,
  NeutralizationRecord,
  PurgeRecord,
} from './evidence.js'
export { isClean, isError, isIgnored, isQuarantined, isRateLimited } from './result.js'
export type { InterceptResult } from './result.js'
export type { Scent } from './scent.js'
export { generateSignature, validateSignature } from './signature.js'
export type { Threat, ThreatCategory, ThreatInput } from './threat.js'
