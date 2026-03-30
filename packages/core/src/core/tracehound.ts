/**
 * Tracehound - Global factory and runtime instance.
 *
 * Provides a single entry point for initializing Tracehound.
 */

import { existsSync, unlinkSync } from 'node:fs'
import { Errors } from '../types/errors.js'
import {
  exportSystemSnapshot,
  resolveSystemSnapshotPath,
  resolveSystemSnapshotSecret,
  writeSystemSnapshotToDisk,
  type SystemSnapshot,
} from '../utils/system-snapshot.js'
import { createAgent, type IAgent } from './agent.js'
import { AuditChain } from './audit-chain.js'
import { createMemoryColdStorage, type IColdStorageAdapter } from './cold-storage.js'
import { EvidenceFactory, type IEvidenceFactory } from './evidence-factory.js'
import {
  createHoundPool,
  isHoundPressureError,
  type HoundPoolConfig,
  type HoundResult,
  type IHoundPool,
} from './hound-pool.js'
import { createNotificationEmitter, type INotificationEmitter } from './notification-emitter.js'
import {
  formatHoundErrorReason,
  formatHoundTimeoutReason,
  SYSTEM_PANIC_REASONS,
} from './operational-events.js'
import {
  PressureController,
  type PressureThresholds,
  type PressureTransition,
} from './pressure-controller.js'
import { Quarantine } from './quarantine.js'
import { createRateLimiter, type IRateLimiter } from './rate-limiter.js'
import { createScheduler, type IScheduler } from './scheduler.js'
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
   * Pressure containment configuration.
   */
  pressure?: {
    elevatedWatermark?: number
    criticalWatermark?: number
    recoverToElevatedWatermark?: number
    recoverToNormalWatermark?: number
    recoveryCooldownMs?: number
  }

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

  /**
   * Runtime dependency overrides.
   * @internal For deterministic testing only. Production use: omit this field.
   */
  runtime?: {
    /**
     * Injectable clock returning current time in ms.
     * When provided, this single clock is used by all time-sensitive subsystems
     * (scheduler, rate-limiter, watcher) as the single source of time.
     * DEFAULT: Date.now
     */
    now?: () => number
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
  private readonly now: () => number
  private readonly pressureController: PressureController
  private readonly scheduler: IScheduler | null
  private readonly snapshotPath: string | null
  private readonly snapshotSecret: string | null
  private readonly snapshotIntervalMs: number | null
  private houndOverloaded = false
  private snapshotIntervalId: ReturnType<typeof setInterval> | null = null

  constructor(options: TracehoundOptions = {}) {
    // eslint-disable-next-line no-restricted-syntax -- intentional bridge: closure defers to global Date.now at call time so vi.useFakeTimers() works regardless of construction order
    const runtimeNow = options.runtime?.now ?? ((): number => Date.now())
    this.now = runtimeNow
    const pressureThresholds = normalizePressureThresholds(
      options.pressure,
      options.watcher?.quarantineHighWatermark,
    )

    // Initialize components
    this.auditChain = new AuditChain()
    this.notifications = createNotificationEmitter({ _now: runtimeNow })
    this.pressureController = new PressureController(pressureThresholds, runtimeNow)
    const shouldProvisionDefaultColdStorage =
      typeof options.quarantine?.ttlMs === 'number' &&
      options.quarantine.ttlMs > 0 &&
      options.quarantine.archiveOnDecay !== false
    this.coldStorage =
      options.coldStorage ??
      (shouldProvisionDefaultColdStorage ? createMemoryColdStorage({ _now: runtimeNow }) : null)

    const quarantineDependencies =
      this.coldStorage === null
        ? {}
        : {
            coldStorage: this.coldStorage,
            isArchiveSuppressed: (): boolean =>
              this.pressureController.snapshot().archiveSuppressed,
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

    this.rateLimiter = createRateLimiter(
      {
        windowMs: options.rateLimit?.windowMs ?? 60_000,
        maxRequests: options.rateLimit?.maxRequests ?? 100,
        blockDurationMs: options.rateLimit?.blockDurationMs ?? 300_000,
      },
      runtimeNow,
    )

    this.watcher = createWatcher({
      maxAlertsPerWindow: options.watcher?.maxAlertsPerWindow ?? 10,
      alertWindowMs: options.watcher?.alertWindowMs ?? 60_000,
      quarantineHighWatermark: options.watcher?.quarantineHighWatermark ?? 0.8,
      _now: runtimeNow,
    })
    this.applyPressureState(null)

    this.evidenceFactory = new EvidenceFactory()
    this.scheduler = this.createQuarantineDecayScheduler(options.quarantine, runtimeNow)

    // Create HoundPool first — Agent depends on it for auto-activation
    const poolConfig: HoundPoolConfig = {
      ...DEFAULT_POOL_CONFIG,
      ...options.houndPool,
      _now: runtimeNow,
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
      (count, bytes, maxBytes) => {
        this.syncPressureFromQuarantine(count, bytes, maxBytes)
      },
    )

    // Wire HoundPool results back into Watcher and NotificationEmitter.
    // timeout/error outcomes are security-relevant events that SecOps must see.
    this.houndPool.onResult((result) => {
      this.syncOverloadState(result)
      this.syncPressureFromHoundResult(result)

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
    return exportSystemSnapshot(this, this.now)
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
        writeSystemSnapshotToDisk(snapshot, this.snapshotPath!, this.snapshotSecret!, this.now)
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

  private syncPressureFromQuarantine(count: number, bytes: number, maxBytes: number): void {
    this.watcher.updateQuarantine(count, bytes, maxBytes)
    const transition = this.pressureController.observeQuarantine(
      this.quarantine.stats,
      maxBytes,
      this.quarantine.maxCount,
    )
    this.applyPressureState(transition)
  }

  private syncPressureFromHoundResult(result: HoundResult): void {
    const transition = this.pressureController.observeHoundResult(
      result,
      this.quarantine.stats,
      this.quarantine.maxBytes,
      this.quarantine.maxCount,
    )
    this.applyPressureState(transition)
  }

  private applyPressureState(transition: PressureTransition | null): void {
    const pressure = this.pressureController.snapshot()
    this.watcher.setPressure(pressure)
    this.reconcileOverloadState()

    if (!transition) {
      return
    }

    this.notifications.emit('pressure.transition', {
      previousMode: transition.previous.mode,
      currentMode: transition.current.mode,
      reason: transition.reason,
      archiveSuppressed: transition.current.archiveSuppressed,
      pressure: transition.current,
    })

    if (transition.previous.archiveSuppressed !== transition.current.archiveSuppressed) {
      this.notifications.emit('pressure.archive_suppressed', {
        mode: transition.current.mode,
        suppressed: transition.current.archiveSuppressed,
        reason: transition.reason,
        pressure: transition.current,
      })
    }
  }

  private syncOverloadState(result: HoundResult): void {
    if (this.isOverloadSignal(result)) {
      this.houndOverloaded = true
      this.reconcileOverloadState()
    }

    if (!this.shouldEvaluateOverloadRecovery(result)) {
      return
    }

    // HoundPool emits results before deferred queue reassignment in the same
    // tick, so recovery checks must run in a microtask.
    queueMicrotask(() => {
      const stats = this.houndPool.stats
      const hasHeadroom = stats.totalProcesses === 0 || stats.activeProcesses < stats.totalProcesses
      if (!hasHeadroom) {
        return
      }

      this.houndOverloaded = false
      const transition = this.pressureController.observeHoundRecovery(
        this.quarantine.stats,
        this.quarantine.maxBytes,
        this.quarantine.maxCount,
      )
      this.applyPressureState(transition)
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

  private reconcileOverloadState(): void {
    const pressure = this.pressureController.snapshot()
    this.watcher.setOverloaded(this.houndOverloaded || pressure.signals.overloaded)
  }

  private createQuarantineDecayScheduler(
    quarantineOptions: TracehoundOptions['quarantine'],
    now: () => number,
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
      _now: now,
    })

    scheduler.schedule({
      id: 'quarantine-decay',
      intervalMs,
      priority: 10,
      execute: async (): Promise<void> => {
        await this.quarantine.decayExpired()
        this.syncPressureFromQuarantine(
          this.quarantine.stats.count,
          this.quarantine.stats.bytes,
          this.quarantine.maxBytes,
        )
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

function normalizePressureThresholds(
  pressure: TracehoundOptions['pressure'],
  fallbackElevatedWatermark: number | undefined,
): PressureThresholds {
  const elevatedWatermark = pressure?.elevatedWatermark ?? fallbackElevatedWatermark ?? 0.8
  const defaultCriticalWatermark = 0.95
  const criticalWatermark =
    pressure?.criticalWatermark ??
    (defaultCriticalWatermark > elevatedWatermark
      ? defaultCriticalWatermark
      : Math.min(1, elevatedWatermark + 0.01))
  const recoverToElevatedWatermark =
    pressure?.recoverToElevatedWatermark ??
    deriveRecoverToElevatedWatermark(elevatedWatermark, criticalWatermark)
  const recoverToNormalWatermark =
    pressure?.recoverToNormalWatermark ?? Math.max(0.01, elevatedWatermark - 0.1)
  const rawRecoveryCooldownMs = pressure?.recoveryCooldownMs ?? 5_000

  if (
    !Number.isFinite(elevatedWatermark) ||
    !Number.isFinite(criticalWatermark) ||
    !Number.isFinite(recoverToElevatedWatermark) ||
    !Number.isFinite(recoverToNormalWatermark) ||
    !Number.isFinite(rawRecoveryCooldownMs)
  ) {
    throw Errors.invalidConfigPressure('pressure thresholds must be finite numbers')
  }

  const recoveryCooldownMs = Math.floor(rawRecoveryCooldownMs)

  if (
    !(
      recoverToNormalWatermark > 0 &&
      recoverToNormalWatermark < elevatedWatermark &&
      elevatedWatermark < recoverToElevatedWatermark &&
      recoverToElevatedWatermark < criticalWatermark &&
      criticalWatermark <= 1
    )
  ) {
    throw Errors.invalidConfigPressure(
      'pressure thresholds must satisfy 0 < recoverToNormal < elevated < recoverToElevated < critical <= 1',
    )
  }

  if (recoveryCooldownMs <= 0) {
    throw Errors.invalidConfigPressure('pressure recoveryCooldownMs must be positive')
  }

  return {
    elevatedWatermark,
    criticalWatermark,
    recoverToElevatedWatermark,
    recoverToNormalWatermark,
    recoveryCooldownMs,
  }
}

function deriveRecoverToElevatedWatermark(
  elevatedWatermark: number,
  criticalWatermark: number,
): number {
  const preferred = Math.min(criticalWatermark - 0.01, elevatedWatermark + 0.05)
  if (preferred > elevatedWatermark) {
    return preferred
  }

  return elevatedWatermark + (criticalWatermark - elevatedWatermark) / 2
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
