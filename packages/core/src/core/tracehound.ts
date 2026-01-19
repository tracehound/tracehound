/**
 * Tracehound - Global factory and runtime instance.
 *
 * Provides a single entry point for initializing Tracehound.
 */

import { createAgent, type IAgent } from './agent.js'
import { AuditChain } from './audit-chain.js'
import { EvidenceFactory, type IEvidenceFactory } from './evidence-factory.js'
import { createHoundPool, type HoundPoolConfig, type IHoundPool } from './hound-pool.js'
import { createNotificationEmitter, type INotificationEmitter } from './notification-emitter.js'
import { Quarantine } from './quarantine.js'
import { createRateLimiter, type IRateLimiter } from './rate-limiter.js'
import { createWatcher, type IWatcher } from './watcher.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tracehound initialization options.
 */
export interface TracehoundOptions {
  /**
   * Maximum payload size in bytes.
   * @default 1_000_000
   */
  maxPayloadSize?: number

  /**
   * Quarantine configuration.
   */
  quarantine?: {
    maxCount?: number
    maxBytes?: number
  }

  /**
   * Rate limiter configuration.
   */
  rateLimit?: {
    windowMs?: number
    maxRequests?: number
    blockDurationMs?: number
  }

  /**
   * Watcher configuration.
   */
  watcher?: {
    maxAlertsPerWindow?: number
    alertWindowMs?: number
    quarantineHighWatermark?: number
  }

  /**
   * Hound pool configuration.
   */
  houndPool?: Partial<HoundPoolConfig>
}

/**
 * Tracehound runtime instance.
 */
export interface ITracehound {
  /** The Agent for intercepting requests */
  readonly agent: IAgent
  /** The Quarantine storage */
  readonly quarantine: Quarantine
  /** The Rate Limiter */
  readonly rateLimiter: IRateLimiter
  /** The Watcher for observability */
  readonly watcher: IWatcher
  /** The Audit Chain */
  readonly auditChain: AuditChain
  /** The Notification Emitter */
  readonly notifications: INotificationEmitter
  /** The Hound Pool */
  readonly houndPool: IHoundPool
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default HoundPool configuration.
 */
const DEFAULT_POOL_CONFIG: HoundPoolConfig = {
  poolSize: 4,
  timeout: 30_000,
  rotationJitterMs: 1000,
  onPoolExhausted: 'defer',
  deferQueueLimit: 100,
}

/**
 * Tracehound runtime implementation.
 */
class Tracehound implements ITracehound {
  readonly agent: IAgent
  readonly quarantine: Quarantine
  readonly rateLimiter: IRateLimiter
  readonly watcher: IWatcher
  readonly auditChain: AuditChain
  readonly notifications: INotificationEmitter
  readonly houndPool: IHoundPool

  private readonly evidenceFactory: IEvidenceFactory

  constructor(options: TracehoundOptions = {}) {
    // Initialize components
    this.auditChain = new AuditChain()
    this.notifications = createNotificationEmitter()

    this.quarantine = new Quarantine(
      {
        maxCount: options.quarantine?.maxCount ?? 10_000,
        maxBytes: options.quarantine?.maxBytes ?? 100_000_000,
        evictionPolicy: 'priority',
      },
      this.auditChain,
    )

    this.rateLimiter = createRateLimiter({
      windowMs: options.rateLimit?.windowMs ?? 60_000,
      maxRequests: options.rateLimit?.maxRequests ?? 100,
      blockDurationMs: options.rateLimit?.blockDurationMs ?? 300_000,
    })

    this.watcher = createWatcher({
      maxAlertsPerWindow: options.watcher?.maxAlertsPerWindow ?? 10,
      alertWindowMs: options.watcher?.alertWindowMs ?? 60_000,
      quarantineHighWatermark: options.watcher?.quarantineHighWatermark ?? 0.8,
    })

    this.evidenceFactory = new EvidenceFactory()

    // Create agent
    this.agent = createAgent(
      { maxPayloadSize: options.maxPayloadSize ?? 1_000_000 },
      this.quarantine,
      this.rateLimiter,
      this.evidenceFactory,
    )

    // Create HoundPool
    const poolConfig: HoundPoolConfig = {
      ...DEFAULT_POOL_CONFIG,
      ...options.houndPool,
    }
    this.houndPool = createHoundPool(poolConfig)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Tracehound instance.
 *
 * @example
 * ```typescript
 * import { createTracehound } from '@tracehound/core'
 *
 * const tracehound = createTracehound()
 *
 * // Use agent
 * const result = tracehound.agent.intercept(scent)
 * ```
 *
 * @param options - Initialization options
 */
export function createTracehound(options: TracehoundOptions = {}): ITracehound {
  return new Tracehound(options)
}
