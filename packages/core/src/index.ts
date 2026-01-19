/**
 * @tracehound/core
 *
 * Security buffer system with immune system architecture.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type {
  AlertConfig,
  AuditConfig,
  ColdStorageConfig,
  ErrorState,
  EvacuateRecord,
  EvidenceHandle,
  GenerateSignatureOptions,
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
  ThreatSignal,
  TracehoundConfig,
  TracehoundError,
} from './types/index.js'

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

export { DEFAULT_CONFIG, mergeWithDefaults } from './types/index.js'

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export { createError, Errors } from './types/index.js'

// ─────────────────────────────────────────────────────────────────────────────
// Result type guards
// ─────────────────────────────────────────────────────────────────────────────

export { isClean, isError, isIgnored, isQuarantined, isRateLimited } from './types/index.js'

// ─────────────────────────────────────────────────────────────────────────────
// Threat helpers
// ─────────────────────────────────────────────────────────────────────────────

export { createThreatInput } from './types/index.js'

// ─────────────────────────────────────────────────────────────────────────────
// Signature
// ─────────────────────────────────────────────────────────────────────────────

export { compareSignatures, generateSignature, validateSignature } from './types/index.js'

// ─────────────────────────────────────────────────────────────────────────────
// Core - Audit Chain
// ─────────────────────────────────────────────────────────────────────────────

export { AuditChain, GENESIS_HASH } from './core/audit-chain.js'

// ─────────────────────────────────────────────────────────────────────────────
// Core - Evidence
// ─────────────────────────────────────────────────────────────────────────────

export { Evidence } from './core/evidence.js'

// ─────────────────────────────────────────────────────────────────────────────
// Core - Quarantine
// ─────────────────────────────────────────────────────────────────────────────

export { Quarantine } from './core/quarantine.js'
export type { InsertResult, QuarantineStats } from './core/quarantine.js'

// ─────────────────────────────────────────────────────────────────────────────
// Core - Rate Limiter
// ─────────────────────────────────────────────────────────────────────────────

export { createRateLimiter, RateLimiter } from './core/rate-limiter.js'
export type { IRateLimiter, RateLimiterStats, RateLimitResult } from './core/rate-limiter.js'

// ─────────────────────────────────────────────────────────────────────────────
// Core - Evidence Factory
// ─────────────────────────────────────────────────────────────────────────────

export { createEvidenceFactory, EvidenceFactory } from './core/evidence-factory.js'
export type {
  EvidenceCreationResult,
  EvidenceFactoryOptions,
  IEvidenceFactory,
} from './core/evidence-factory.js'

// ─────────────────────────────────────────────────────────────────────────────
// Core - Agent
// ─────────────────────────────────────────────────────────────────────────────

export { Agent, createAgent } from './core/agent.js'
export type { AgentConfig, AgentStats, IAgent } from './core/agent.js'

// ─────────────────────────────────────────────────────────────────────────────
// Core - Hound Pool
// ─────────────────────────────────────────────────────────────────────────────

export { createHoundPool, createMockAdapter, HoundPool } from './core/hound-pool.js'
export type {
  HoundPoolConfig,
  HoundPoolStats,
  HoundResult,
  IHoundPool,
  PoolExhaustedAction,
} from './core/hound-pool.js'
export type { HoundProcessConstraints } from './core/process-adapter.js'

// ─────────────────────────────────────────────────────────────────────────────
// Core - Scheduler
// ─────────────────────────────────────────────────────────────────────────────

export { createScheduler, Scheduler } from './core/scheduler.js'
export type {
  BusyChecker,
  IScheduler,
  ScheduledTask,
  SchedulerStats,
  TickSchedulerConfig,
} from './core/scheduler.js'

// ─────────────────────────────────────────────────────────────────────────────
// Core - Watcher
// ─────────────────────────────────────────────────────────────────────────────

export { createWatcher, Watcher } from './core/watcher.js'
export type {
  Alert,
  AlertSeverity,
  AlertType,
  IWatcher,
  ThreatStats,
  WatcherConfig,
  WatcherQuarantineStats,
  WatcherSnapshot,
} from './core/watcher.js'

// ─────────────────────────────────────────────────────────────────────────────
// Utils - Hashing
// ─────────────────────────────────────────────────────────────────────────────

export { hash, hashBuffer } from './utils/hash.js'

// ─────────────────────────────────────────────────────────────────────────────
// Utils - ID generation
// ─────────────────────────────────────────────────────────────────────────────

export { generateSecureId, isValidSecureId } from './utils/id.js'

// ─────────────────────────────────────────────────────────────────────────────
// Utils - Serialization
// ─────────────────────────────────────────────────────────────────────────────

export { serialize } from './utils/serialize.js'

// ─────────────────────────────────────────────────────────────────────────────
// Utils - Security
// ─────────────────────────────────────────────────────────────────────────────

export { createColdPathCodec, createHotPathCodec, GzipCodec } from './utils/binary-codec.js'
export type { CodecStats, ColdPathCodec, HotPathCodec } from './utils/binary-codec.js'
export { constantTimeBufferEqual, constantTimeEqual } from './utils/compare.js'
export { encodePayload, estimatePayloadSize } from './utils/encode.js'
export type { EncodeResult } from './utils/encode.js'

// ─────────────────────────────────────────────────────────────────────────────
// Core - Cold Storage
// ─────────────────────────────────────────────────────────────────────────────

export { createMemoryColdStorage, MemoryColdStorage } from './core/cold-storage.js'
export type {
  ColdStorageReadResult,
  ColdStorageWriteResult,
  IColdStorageAdapter,
} from './core/cold-storage.js'

// ─────────────────────────────────────────────────────────────────────────────
// Core - Trust Boundary
// ─────────────────────────────────────────────────────────────────────────────

export {
  DEFAULT_TRUST_BOUNDARY,
  isClusterUntrusted,
  mergeTrustBoundary,
  shouldVerifyDetector,
  validateTrustBoundary,
} from './core/trust-boundary.js'
export type {
  ClusterBoundaryConfig,
  ClusterTrustLevel,
  ColdStorageBoundaryConfig,
  ColdStorageTrustLevel,
  DetectorBoundaryConfig,
  DetectorTrustLevel,
  TrustBoundaryConfig,
} from './core/trust-boundary.js'

// ─────────────────────────────────────────────────────────────────────────────
// Core - Lane Queue
// ─────────────────────────────────────────────────────────────────────────────

export { createLaneQueue, DEFAULT_LANE_CONFIG, LaneQueue } from './core/lane-queue.js'
export type {
  Alert as LaneAlert,
  LaneConfig,
  LaneQueueConfig,
  LaneStats,
} from './core/lane-queue.js'

// ─────────────────────────────────────────────────────────────────────────────
// Core - Fail-Safe
// ─────────────────────────────────────────────────────────────────────────────

export { createFailSafe, DEFAULT_FAIL_SAFE_CONFIG, FailSafe } from './core/fail-safe.js'
export type {
  FailSafeConfig,
  PanicCallback,
  PanicEvent,
  PanicLevel,
  PanicReason,
  ThresholdConfig,
} from './core/fail-safe.js'

// ─────────────────────────────────────────────────────────────────────────────
// Core - Tracehound Factory
// ─────────────────────────────────────────────────────────────────────────────

export { createTracehound } from './core/tracehound.js'
export type { ITracehound, TracehoundOptions } from './core/tracehound.js'

// ─────────────────────────────────────────────────────────────────────────────
// Core - Notification Emitter
// ─────────────────────────────────────────────────────────────────────────────

export { createNotificationEmitter, NotificationEmitter } from './core/notification-emitter.js'
export type {
  EventCallback,
  EventType,
  EvidenceEvictedPayload,
  EvidenceQuarantinedPayload,
  INotificationEmitter,
  LicenseExpiredPayload,
  LicenseValidatedPayload,
  NotificationEmitterStats,
  RateLimitExceededPayload,
  SystemPanicPayload,
  ThreatDetectedPayload,
  TracehoundEvent,
  WebhookConfig,
} from './core/notification-emitter.js'

// ─────────────────────────────────────────────────────────────────────────────
// Core - Security State
// ─────────────────────────────────────────────────────────────────────────────

export { createSecurityState, SecurityState } from './core/security-state.js'
export type {
  ISecurityState,
  LicenseState,
  QuarantineStateStats,
  RateLimitStats,
  SecurityHistoryEntry,
  SecuritySnapshot,
  SecurityStateConfig,
  SecurityStateStats,
} from './core/security-state.js'
