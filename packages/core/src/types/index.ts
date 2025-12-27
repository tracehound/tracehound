/**
 * Type re-exports.
 */

export type { AuditRecord, IAuditChain } from './audit.js'
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
export { ErrorCodes, Errors, createError } from './errors.js'
export type { ErrorCode, ErrorState, TracehoundError } from './errors.js'
export type {
  EvacuateRecord,
  EvidenceHandle,
  NeutralizationRecord,
  PurgeRecord,
} from './evidence.js'
export { isClean, isError, isIgnored, isQuarantined, isRateLimited } from './result.js'
export type { InterceptResult } from './result.js'
export type { Scent, ThreatCategory, ThreatSignal } from './scent.js'
export { compareSignatures, generateSignature, validateSignature } from './signature.js'
export type { GenerateSignatureOptions } from './signature.js'
export { createThreatInput } from './threat.js'
export type { Threat, ThreatInput } from './threat.js'
