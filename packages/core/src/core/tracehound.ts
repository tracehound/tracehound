/**
 * Tracehound - Global factory and runtime instance.
 *
 * Provides a single entry point for initializing Tracehound.
 */

import { createAgent, type IAgent } from './agent.js'
import { AuditChain } from './audit-chain.js'
import { EvidenceFactory, type IEvidenceFactory } from './evidence-factory.js'
import {
  createHoundPool,
  isHoundPressureError,
  type HoundPoolConfig,
  type HoundResult,
  type IHoundPool,
} from './hound-pool.js'
import { createNotificationEmitter, type INotificationEmitter } from './notification-emitter.js'
import { Quarantine } from './quarantine.js'
import { createRateLimiter, type IRateLimiter } from './rate-limiter.js'
import { createScheduler, type IScheduler } from './scheduler.js'
import { createWatcher, type IWatcher } from './watcher.js'
import { createMemoryColdStorage, type IColdStorageAdapter } from './cold-storage.js'
import { Errors } from '../types/errors.js'
import { existsSync, unlinkSync } from 'node:fs'
import {
  formatHoundErrorReason,
  formatHoundTimeoutReason,
  SYSTEM_PANIC_REASONS,
} from './operational-events.js'
import {
  exportSystemSnapshot,
  resolveSystemSnapshotPath,
  resolveSystemSnapshotSecret,
  type SystemSnapshot,
  writeSystemSnapshotToDisk,
} from '../utils/system-snapshot.js'

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
    ttlMs?: number
    decayIntervalMs?: number
    decayBatchSize?: number
    archiveOnDecay?: boolean
    archiveFailureMode?: 'drop' | 'retain'
    /** Timeout for a single cold storage archive write in ms. Default: 5000 */
    archiveTimeoutMs?: number
  }

  /**
   * Optional cold storage adapter for background quarantine decay archival.
   */
  coldStorage?: IColdStorageAdapter

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

  /**
   * System snapshot export configuration.
   */
  snapshot?: {
    /** Snapshot output path (required when snapshot export is enabled). */
    path: string
    /** Snapshot HMAC secret (falls back to TRACEHOUND_SNAPSHOT_SECRET). */
    secret?: string
    /** Flush interval in ms. Default: 1000 */
    intervalMs?: number
  }
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
  /** Background cold storage used for TTL archival */
  readonly coldStorage: IColdStorageAdapter | null

  /**
   * Return immutable runtime snapshot.
   */
  snapshot(): SystemSnapshot

  /**
   * Dispose runtime resources (snapshot loop and hound processes).
   */
  shutdown(): void
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
  readonly coldStorage: IColdStorageAdapter | null

  private readonly evidenceFactory: IEvidenceFactory
  private readonly scheduler: IScheduler | null
  private readonly snapshotPath: string | null
  private readonly snapshotSecret: string | null
  private readonly snapshotIntervalMs: number | null
  private snapshotIntervalId: ReturnType<typeof setInterval> | null = null

  constructor(options: TracehoundOptions = {}) {
    // Initialize components
    this.auditChain = new AuditChain()
    this.notifications = createNotificationEmitter()
    const shouldProvisionDefaultColdStorage =
      typeof options.quarantine?.ttlMs === 'number' &&
      options.quarantine.ttlMs > 0 &&
      options.quarantine.archiveOnDecay !== false
    this.coldStorage = options.coldStorage ?? (shouldProvisionDefaultColdStorage ? createMemoryColdStorage() : null)

    const quarantineDependencies =
      this.coldStorage === null
        ? {}
        : {
            coldStorage: this.coldStorage,
          }

    this.quarantine = new Quarantine(
      {
        maxCount: options.quarantine?.maxCount ?? 10_000,
        maxBytes: options.quarantine?.maxBytes ?? 100_000_000,
        evictionPolicy: 'priority',
        ttlMs: options.quarantine?.ttlMs ?? 0,
        decayIntervalMs: options.quarantine?.decayIntervalMs ?? 1_000,
        decayBatchSize: options.quarantine?.decayBatchSize ?? 128,
        archiveOnDecay: options.quarantine?.archiveOnDecay ?? true,
        archiveFailureMode: options.quarantine?.archiveFailureMode ?? 'drop',
        archiveTimeoutMs: options.quarantine?.archiveTimeoutMs ?? 5_000,
      },
      this.auditChain,
      quarantineDependencies,
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
    this.scheduler = this.createQuarantineDecayScheduler(options.quarantine)

    // Create HoundPool first — Agent depends on it for auto-activation
    const poolConfig: HoundPoolConfig = {
      ...DEFAULT_POOL_CONFIG,
      ...options.houndPool,
    }
    this.houndPool = createHoundPool(poolConfig)

    // Create agent — houndPool, watcher, and notifications are all wired in.
    // Quarantined evidence is forwarded to the pool, and observability events
    // are emitted automatically without any user configuration.
    this.agent = createAgent(
      { maxPayloadSize: options.maxPayloadSize ?? 1_000_000 },
      this.quarantine,
      this.rateLimiter,
      this.evidenceFactory,
      this.houndPool,
      this.watcher,
      this.notifications,
    )

    // Wire HoundPool results back into Watcher and NotificationEmitter.
    // timeout/error outcomes are security-relevant events that SecOps must see.
    this.houndPool.onResult((result) => {
      this.syncOverloadState(result)

      if (result.status === 'timeout') {
        this.watcher.alert({
          type: 'hound_timeout',
          severity: 'warning',
          message: `Hound worker timed out after ${result.durationMs}ms`,
          context: { signature: result.signature, processId: result.processId },
        })
        this.notifications.emit('system.panic', {
          level: 'warning',
          reason: formatHoundTimeoutReason(result.signature),
        })
      } else if (result.status === 'error') {
        this.watcher.alert({
          type: 'system_overload',
          severity: 'critical',
          message: `Hound worker error: ${result.error ?? 'unknown'}`,
          context: { signature: result.signature, processId: result.processId },
        })
        this.notifications.emit('system.panic', {
          level: 'critical',
          reason: formatHoundErrorReason(result.error ?? 'unknown'),
        })
      }
    })

    const snapshotConfig = options.snapshot
    if (snapshotConfig) {
      if (typeof snapshotConfig.path !== 'string' || snapshotConfig.path.length === 0) {
        throw Errors.invalidConfigSnapshot('path is required when snapshot export is enabled')
      }

      const resolvedSecret = resolveSystemSnapshotSecret(snapshotConfig.secret)
      if (!resolvedSecret) {
        throw Errors.snapshotSecretMissing()
      }

      const intervalMs = normalizeSnapshotInterval(snapshotConfig.intervalMs)
      if (intervalMs <= 0) {
        throw Errors.invalidConfigSnapshot('intervalMs must be positive')
      }

      this.snapshotPath = resolveSystemSnapshotPath(snapshotConfig.path)
      this.snapshotSecret = resolvedSecret
      this.snapshotIntervalMs = intervalMs
      this.startSnapshotLoop()
    } else {
      this.snapshotPath = null
      this.snapshotSecret = null
      this.snapshotIntervalMs = null
    }
  }

  snapshot(): SystemSnapshot {
    return exportSystemSnapshot(this)
  }

  shutdown(): void {
    this.scheduler?.stop()
    this.stopSnapshotLoop()
    this.cleanupSnapshotFile()
    this.auditChain.flushPending()
    this.houndPool.shutdown()
  }

  private startSnapshotLoop(): void {
    if (!this.snapshotPath || !this.snapshotSecret || !this.snapshotIntervalMs) {
      return
    }

    const flush = (): void => {
      try {
        const snapshot = this.snapshot()
        writeSystemSnapshotToDisk(snapshot, this.snapshotPath!, this.snapshotSecret!)
      } catch (error: unknown) {
        this.notifications.emit('system.panic', {
          level: 'warning',
          reason: SYSTEM_PANIC_REASONS.SNAPSHOT_WRITE_FAILED,
          context: { error: error instanceof Error ? error.message : 'unknown' },
        })
      }
    }

    flush()
    this.snapshotIntervalId = setInterval(flush, this.snapshotIntervalMs)
    if (typeof this.snapshotIntervalId.unref === 'function') {
      this.snapshotIntervalId.unref()
    }
  }

  private stopSnapshotLoop(): void {
    if (!this.snapshotIntervalId) {
      return
    }

    clearInterval(this.snapshotIntervalId)
    this.snapshotIntervalId = null
  }

  private cleanupSnapshotFile(): void {
    if (!this.snapshotPath) {
      return
    }

    try {
      if (existsSync(this.snapshotPath)) {
        unlinkSync(this.snapshotPath)
      }
    } catch (error: unknown) {
      this.notifications.emit('system.panic', {
        level: 'warning',
        reason: SYSTEM_PANIC_REASONS.SNAPSHOT_CLEANUP_FAILED,
        context: { error: error instanceof Error ? error.message : 'unknown' },
      })
    }
  }

  private syncOverloadState(result: HoundResult): void {
    const overloadSignal = this.isOverloadSignal(result)
    if (overloadSignal) {
      this.watcher.setOverloaded(true)
    }

    if (!this.shouldEvaluateOverloadRecovery(result)) {
      return
    }

    // HoundPool emits results before deferred queue reassignment in the same
    // tick, so recovery checks must run in a microtask.
    queueMicrotask(() => {
      const stats = this.houndPool.stats
      const hasHeadroom =
        stats.totalProcesses === 0 || stats.activeProcesses < stats.totalProcesses
      if (hasHeadroom) {
        this.watcher.setOverloaded(false)
      }
    })
  }

  private shouldEvaluateOverloadRecovery(result: HoundResult): boolean {
    if (result.status === 'processed' || result.status === 'timeout') {
      return true
    }

    if (result.status !== 'error') {
      return false
    }

    if (!result.error) {
      return true
    }

    return !isHoundPressureError(result.error)
  }

  private isOverloadSignal(result: HoundResult): boolean {
    if (result.status === 'timeout') {
      return true
    }

    if (result.status !== 'error') {
      return false
    }

    if (!result.error) {
      return false
    }

    return isHoundPressureError(result.error)
  }

  private createQuarantineDecayScheduler(
    quarantineOptions: TracehoundOptions['quarantine'],
  ): IScheduler | null {
    const ttlMs = quarantineOptions?.ttlMs ?? 0
    if (ttlMs <= 0) {
      return null
    }

    const intervalMs = normalizeDecayInterval(quarantineOptions?.decayIntervalMs)
    if (intervalMs <= 0) {
      return null
    }

    const scheduler = createScheduler({
      tickInterval: intervalMs,
      jitterMs: Math.min(intervalMs, 250),
      skipIfBusy: true,
      maxTasksPerTick: 1,
    })

    scheduler.schedule({
      id: 'quarantine-decay',
      intervalMs,
      priority: 10,
      execute: async (): Promise<void> => {
        await this.quarantine.decayExpired()
      },
    })
    scheduler.start()

    return scheduler
  }
}

function normalizeDecayInterval(intervalMs: number | undefined): number {
  if (intervalMs === undefined) {
    return 1_000
  }

  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return 0
  }

  return Math.floor(intervalMs)
}

function normalizeSnapshotInterval(intervalMs: number | undefined): number {
  if (intervalMs === undefined) {
    return 1000
  }

  if (!Number.isFinite(intervalMs)) {
    return 0
  }

  return Math.floor(intervalMs)
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
