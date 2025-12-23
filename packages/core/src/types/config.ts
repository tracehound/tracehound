/**
 * Tracehound configuration types and defaults.
 */

/** Rate limiter configuration */
export interface RateLimitConfig {
  /** Time window in milliseconds */
  windowMs: number
  /** Max requests per window */
  maxRequests: number
  /** Block duration after limit exceeded */
  blockDurationMs: number
}

/** Quarantine storage configuration */
export interface QuarantineConfig {
  /** Maximum number of quarantined items */
  maxCount: number
  /** Maximum bytes in quarantine */
  maxBytes: number
  /** Eviction strategy */
  evictionPolicy: 'lru' | 'priority'
}

/** Hound pool configuration */
export interface HoundConfig {
  /** Minimum dormant hounds */
  minimumDormant: number
  /** Maximum active hounds */
  maxActive: number
  /** Max operations before rotation */
  maxLifeTimeCycle: number
  /** Processing timeout in milliseconds */
  maxProcessingTime: number
  /** Delay before replenishing pool */
  replenishDelay: number
}

/** Scheduler configuration */
export interface SchedulerConfig {
  /** Base rotation interval */
  rotationInterval: number
  /** Maximum jitter for timing attack prevention */
  jitterMax: number
  /** Skip rotation if busy */
  skipIfBusy: boolean
}

/** Alert configuration */
export interface AlertConfig {
  /** Maximum alerts per window */
  maxAlertsPerWindow: number
  /** Alert window in milliseconds */
  windowMs: number
  /** Alerts before escalation */
  escalationThreshold: number
}

/** Cold storage configuration */
export interface ColdStorageConfig {
  /** Storage type */
  type: 'url'
  /** Storage endpoint */
  endpoint: string
}

/** Audit configuration */
export interface AuditConfig {
  /** Enable hash chain integrity */
  chainEnabled: boolean
  /** Cold storage for evidence */
  coldStorage?: ColdStorageConfig | undefined
}

/** Runtime configuration */
export interface RuntimeConfig {
  /** Enforce runtime flags (--disable-proto) */
  strictRuntimeFlags: boolean
}

/** Complete Tracehound configuration */
export interface TracehoundConfig {
  /** Maximum payload size in bytes */
  maxPayloadSize: number
  /** Rate limiting settings */
  rateLimit: RateLimitConfig
  /** Quarantine settings */
  quarantine: QuarantineConfig
  /** Hound pool settings */
  hound: HoundConfig
  /** Scheduler settings */
  scheduler: SchedulerConfig
  /** Alert settings */
  alerts: AlertConfig
  /** Audit settings */
  audit: AuditConfig
  /** Runtime settings */
  runtime: RuntimeConfig
}

/** Default configuration values */
export const DEFAULT_CONFIG: TracehoundConfig = {
  maxPayloadSize: 1_000_000,
  rateLimit: {
    windowMs: 60_000,
    maxRequests: 100,
    blockDurationMs: 300_000,
  },
  quarantine: {
    maxCount: 10_000,
    maxBytes: 100_000_000,
    evictionPolicy: 'priority',
  },
  hound: {
    minimumDormant: 2,
    maxActive: 4,
    maxLifeTimeCycle: 1000,
    maxProcessingTime: 5_000,
    replenishDelay: 100,
  },
  scheduler: {
    rotationInterval: 60_000,
    jitterMax: 10_000,
    skipIfBusy: true,
  },
  alerts: {
    maxAlertsPerWindow: 10,
    windowMs: 60_000,
    escalationThreshold: 5,
  },
  audit: {
    chainEnabled: true,
  },
  runtime: {
    strictRuntimeFlags: true,
  },
}

/**
 * Merge partial config with defaults.
 * Deep merges nested config objects.
 */
export function mergeWithDefaults(partial: Partial<TracehoundConfig>): TracehoundConfig {
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    rateLimit: { ...DEFAULT_CONFIG.rateLimit, ...partial.rateLimit },
    quarantine: { ...DEFAULT_CONFIG.quarantine, ...partial.quarantine },
    hound: { ...DEFAULT_CONFIG.hound, ...partial.hound },
    scheduler: { ...DEFAULT_CONFIG.scheduler, ...partial.scheduler },
    alerts: { ...DEFAULT_CONFIG.alerts, ...partial.alerts },
    audit: { ...DEFAULT_CONFIG.audit, ...partial.audit },
    runtime: { ...DEFAULT_CONFIG.runtime, ...partial.runtime },
  }
}
