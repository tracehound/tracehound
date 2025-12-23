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

export { Errors, createError } from './types/index.js'

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

export { RateLimiter, createRateLimiter } from './core/rate-limiter.js'
export type { IRateLimiter, RateLimitResult, RateLimiterStats } from './core/rate-limiter.js'

// ─────────────────────────────────────────────────────────────────────────────
// Core - Evidence Factory
// ─────────────────────────────────────────────────────────────────────────────

export { EvidenceFactory, createEvidenceFactory } from './core/evidence-factory.js'
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

export { HoundPool, createHoundPool, createMockAdapter } from './core/hound-pool.js'
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

export { Scheduler, createScheduler } from './core/scheduler.js'
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

export { Watcher, createWatcher } from './core/watcher.js'
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

export { GzipCodec, createColdPathCodec, createHotPathCodec } from './utils/binary-codec.js'
export type { CodecStats, ColdPathCodec, HotPathCodec } from './utils/binary-codec.js'
export { constantTimeBufferEqual, constantTimeEqual } from './utils/compare.js'
export { encodePayload, estimatePayloadSize } from './utils/encode.js'
export type { EncodeResult } from './utils/encode.js'
