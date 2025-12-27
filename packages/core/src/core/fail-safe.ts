/**
 * Fail-Safe Panic - Threshold-triggered emergency callbacks.
 *
 * Provides hooks for emergency situations:
 * - Memory threshold exceeded
 * - Quarantine capacity critical
 * - Error rate exceeded
 * - Manual panic trigger
 *
 * DESIGN:
 * - Panic levels: warning, critical, emergency
 * - Each level can have multiple callbacks
 * - Emergency triggers immediate flush and cleanup
 * - All callbacks are non-blocking (fire-and-forget)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Panic levels.
 */
export type PanicLevel = 'warning' | 'critical' | 'emergency'

/**
 * Panic trigger reasons.
 */
export type PanicReason =
  | 'memory_threshold'
  | 'quarantine_capacity'
  | 'error_rate'
  | 'process_exhaustion'
  | 'manual'

/**
 * Panic event payload.
 */
export interface PanicEvent {
  /** Panic level */
  level: PanicLevel
  /** Trigger reason */
  reason: PanicReason
  /** Event timestamp */
  timestamp: number
  /** Additional context */
  context: {
    /** Current value that triggered panic */
    current?: number
    /** Threshold that was exceeded */
    threshold?: number
    /** Additional details */
    details?: string
  }
}

/**
 * Panic callback signature.
 */
export type PanicCallback = (event: PanicEvent) => void | Promise<void>

/**
 * Threshold configuration.
 */
export interface ThresholdConfig {
  /** Warning threshold (0-1, percentage) */
  warning: number
  /** Critical threshold (0-1, percentage) */
  critical: number
  /** Emergency threshold (0-1, percentage) */
  emergency: number
}

/**
 * Fail-safe configuration.
 */
export interface FailSafeConfig {
  /** Memory usage thresholds */
  memory: ThresholdConfig
  /** Quarantine capacity thresholds */
  quarantine: ThresholdConfig
  /** Error rate thresholds (errors per minute) */
  errorRate: ThresholdConfig
}

/**
 * Default thresholds.
 */
export const DEFAULT_FAIL_SAFE_CONFIG: FailSafeConfig = {
  memory: {
    warning: 0.7, // 70%
    critical: 0.85, // 85%
    emergency: 0.95, // 95%
  },
  quarantine: {
    warning: 0.7,
    critical: 0.85,
    emergency: 0.95,
  },
  errorRate: {
    warning: 10, // 10 errors/min
    critical: 50, // 50 errors/min
    emergency: 100, // 100 errors/min
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fail-Safe Panic system.
 */
export class FailSafe {
  private callbacks: Map<PanicLevel, PanicCallback[]> = new Map([
    ['warning', []],
    ['critical', []],
    ['emergency', []],
  ])

  private panicHistory: PanicEvent[] = []
  private readonly maxHistory = 100

  constructor(private config: FailSafeConfig = DEFAULT_FAIL_SAFE_CONFIG) {}

  /**
   * Register a callback for a panic level.
   *
   * @param level - Panic level to listen for
   * @param callback - Callback function
   */
  on(level: PanicLevel, callback: PanicCallback): void {
    this.callbacks.get(level)!.push(callback)
  }

  /**
   * Register a callback for all panic levels.
   *
   * @param callback - Callback function
   */
  onAny(callback: PanicCallback): void {
    this.on('warning', callback)
    this.on('critical', callback)
    this.on('emergency', callback)
  }

  /**
   * Check memory usage and trigger panic if needed.
   *
   * @param usedBytes - Current memory usage
   * @param totalBytes - Total available memory
   */
  checkMemory(usedBytes: number, totalBytes: number): void {
    const ratio = usedBytes / totalBytes
    const level = this.determineLevel(ratio, this.config.memory)

    if (level) {
      this.trigger({
        level,
        reason: 'memory_threshold',
        timestamp: Date.now(),
        context: {
          current: ratio,
          threshold: this.config.memory[level],
          details: `Memory usage: ${(ratio * 100).toFixed(1)}%`,
        },
      })
    }
  }

  /**
   * Check quarantine capacity and trigger panic if needed.
   *
   * @param current - Current quarantine count
   * @param max - Maximum quarantine capacity
   */
  checkQuarantine(current: number, max: number): void {
    const ratio = current / max
    const level = this.determineLevel(ratio, this.config.quarantine)

    if (level) {
      this.trigger({
        level,
        reason: 'quarantine_capacity',
        timestamp: Date.now(),
        context: {
          current: ratio,
          threshold: this.config.quarantine[level],
          details: `Quarantine: ${current}/${max}`,
        },
      })
    }
  }

  /**
   * Check error rate and trigger panic if needed.
   *
   * @param errorsPerMinute - Current error rate
   */
  checkErrorRate(errorsPerMinute: number): void {
    const level = this.determineLevel(errorsPerMinute, this.config.errorRate)

    if (level) {
      this.trigger({
        level,
        reason: 'error_rate',
        timestamp: Date.now(),
        context: {
          current: errorsPerMinute,
          threshold: this.config.errorRate[level],
          details: `Error rate: ${errorsPerMinute}/min`,
        },
      })
    }
  }

  /**
   * Manually trigger a panic.
   *
   * @param level - Panic level
   * @param details - Optional details
   */
  panic(level: PanicLevel, details?: string): void {
    this.trigger({
      level,
      reason: 'manual',
      timestamp: Date.now(),
      context: details ? { details } : {},
    })
  }

  /**
   * Trigger a panic event.
   *
   * @param event - Panic event
   */
  trigger(event: PanicEvent): void {
    // Add to history
    this.panicHistory.push(event)
    if (this.panicHistory.length > this.maxHistory) {
      this.panicHistory.shift()
    }

    // Fire callbacks (non-blocking)
    const callbacks = this.callbacks.get(event.level)!
    for (const callback of callbacks) {
      try {
        const result = callback(event)
        if (result instanceof Promise) {
          result.catch(() => {
            // Swallow async errors - fail-safe must not throw
          })
        }
      } catch {
        // Swallow sync errors - fail-safe must not throw
      }
    }
  }

  /**
   * Get panic history.
   */
  get history(): readonly PanicEvent[] {
    return this.panicHistory
  }

  /**
   * Get last panic event.
   */
  get lastPanic(): PanicEvent | undefined {
    return this.panicHistory[this.panicHistory.length - 1]
  }

  /**
   * Determine panic level based on value and thresholds.
   */
  private determineLevel(value: number, thresholds: ThresholdConfig): PanicLevel | null {
    if (value >= thresholds.emergency) return 'emergency'
    if (value >= thresholds.critical) return 'critical'
    if (value >= thresholds.warning) return 'warning'
    return null
  }
}

/**
 * Create a fail-safe instance.
 *
 * @param config - Optional configuration
 * @returns FailSafe instance
 */
export function createFailSafe(config?: Partial<FailSafeConfig>): FailSafe {
  const mergedConfig: FailSafeConfig = {
    memory: { ...DEFAULT_FAIL_SAFE_CONFIG.memory, ...config?.memory },
    quarantine: { ...DEFAULT_FAIL_SAFE_CONFIG.quarantine, ...config?.quarantine },
    errorRate: { ...DEFAULT_FAIL_SAFE_CONFIG.errorRate, ...config?.errorRate },
  }

  return new FailSafe(mergedConfig)
}
