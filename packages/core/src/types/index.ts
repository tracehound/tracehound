/**
 * Type re-exports.
 */

export type { AuditRecord, IAuditChain } from './audit.js'
export type { AuditLifecycleRecord } from './audit.js'
export type { JsonPrimitive, JsonSerializable, Severity } from './common.js'
export type { PressureMode, PressureSignals, PressureState } from './pressure.js'
export type {
  CoordinationFeature,
  CoordinationHealth,
  CoordinationMode,
  CoordinationProvider,
} from './coordination.js'
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
  DecayRecord,
  DropRecord,
  EvacuateRecord,
  EvictionRecord,
  EvidenceHandle,
  NeutralizationRecord,
  PurgeRecord,
} from './evidence.js'
export { isClean, isError, isIgnored, isQuarantined, isRateLimited } from './result.js'
export type { InterceptResult, RuntimeEvidenceHandle } from './result.js'
export type {
  Scent,
  ScentSource,
  TLSConnectionInfo,
  ThreatCategory,
  ThreatSignal,
} from './scent.js'
export { compareSignatures, generateSignature, validateSignature } from './signature.js'
export type { GenerateSignatureOptions } from './signature.js'
export { createThreatInput } from './threat.js'
export type { Threat, ThreatInput } from './threat.js'
