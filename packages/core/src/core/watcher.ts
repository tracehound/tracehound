/**
 * Watcher - pull-based observability for system state.
 *
 * RFC-0000 CRITICAL INVARIANTS:
 * - NO EventEmitter pattern (pull-based only)
 * - snapshot() returns immutable state
 * - alert() is internal, rate-limited
 * - Watcher is an observer, not a controller
 */

import type { Severity } from '../types/common.js'
import type { PressureState } from '../types/pressure.js'
import { generateSecureId } from '../utils/id.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Alert severity levels.
 */
export type AlertSeverity = 'info' | 'warning' | 'critical'

/**
 * Alert definition.
 */
export interface Alert {
  /** Alert ID */
  id: string
  /** Alert type */
  type: AlertType
  /** Alert severity */
  severity: AlertSeverity
  /** Human-readable message */
  message: string
  /** Timestamp of alert */
  timestamp: number
  /** Additional context */
  context?: Record<string, unknown>
}

/**
 * Alert types.
 */
export const WATCHER_ALERT_TYPES = Object.freeze([
  'threat_detected',
  'evidence_neutralized',
  'quarantine_full',
  'quarantine_high',
  'rate_limit_exceeded',
  'hound_timeout',
  'system_overload',
] as const)

export type AlertType = (typeof WATCHER_ALERT_TYPES)[number]

/**
 * Threat statistics.
 */
export interface ThreatStats {
  /** Total threats detected */
  total: number
  /** Threats by category */
  byCategory: Record<string, number>
  /** Threats by severity */
  bySeverity: Record<Severity, number>
}

/**
 * Quarantine statistics (from Watcher perspective).
 */
export interface WatcherQuarantineStats {
  /** Current count */
  count: number
  /** Current bytes */
  bytes: number
  /** Capacity percentage */
  capacityPercent: number
}

/**
 * Watcher snapshot (immutable).
 */
export interface WatcherSnapshot {
  /** System uptime in ms */
  uptimeMs: number
  /** Threat statistics */
  threats: ThreatStats
  /** Quarantine statistics */
  quarantine: WatcherQuarantineStats
  /** Total alerts emitted */
  totalAlerts: number
  /** Alerts in current window */
  alertsInWindow: number
  /** Last alert (if any) */
  lastAlert: Alert | null
  /** Whether system is in overload state */
  overloaded: boolean
  /** Current pressure containment state */
  pressure: Readonly<PressureState>
  /** Timestamp of snapshot */
  snapshotTime: number
}

/**
 * Watcher configuration.
 */
export interface WatcherConfig {
  /** Maximum alerts per window (rate limiting) */
  maxAlertsPerWindow: number
  /** Alert window in ms */
  alertWindowMs: number
  /** Quarantine high watermark (0-1) */
  quarantineHighWatermark: number
  /** Maximum total alerts to keep in memory (default: 10000) */
  maxAlerts?: number
  /**
   * Injectable clock returning current time in ms.
   * DEFAULT: Date.now.
   * @internal For deterministic testing only.
   */
  _now?: () => number
}

/**
 * Watcher interface.
 *
 * CRITICAL: NO EventEmitter. Pull-based only.
 */
export interface IWatcher {
  /**
   * Get current state snapshot.
   * External consumers poll this.
   */
  snapshot(): Readonly<WatcherSnapshot>

  /**
   * Record a threat detection.
   * Internal use only.
   */
  recordThreat(category: string, severity: Severity): void

  /**
   * Update quarantine stats.
   * Internal use only.
   */
  updateQuarantine(count: number, bytes: number, maxBytes: number): void

  /**
   * Emit an alert (rate-limited).
   * Internal use only.
   */
  alert(alert: Omit<Alert, 'id' | 'timestamp'>): boolean

  /**
   * Mark system as overloaded.
   */
  setOverloaded(overloaded: boolean): void

  /**
   * Update current pressure state.
   * Internal use only.
   */
  setPressure(pressure: PressureState): void
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Watcher implementation.
 *
 * Pull-based observability. No EventEmitter.
 */
export class Watcher implements IWatcher {
  private readonly startTime: number
  private readonly alerts: Alert[] = []
  private alertWindowStart: number
  private alertsInCurrentWindow = 0

  // Threat tracking
  private _totalThreats = 0
  private readonly threatsByCategory: Map<string, number> = new Map()
  private readonly threatsBySeverity: Map<Severity, number> = new Map()

  // Quarantine tracking
  private _quarantineCount = 0
  private _quarantineBytes = 0
  private _quarantineCapacity = 0

  // State
  private _overloaded = false
  private _pressure = Object.freeze({
    mode: 'normal',
    archiveSuppressed: false,
    updatedAt: 0,
    signals: Object.freeze({
      quarantineBytes: 0,
      quarantineCount: 0,
      quarantineCapacityPercent: 0,
      droppedEvents: 0,
      archiveFailureCount: 0,
      houndPressureEvents: 0,
      overloaded: false,
    }),
  }) as PressureState
  private _lastAlert: Alert | null = null

  private readonly maxAlerts: number
  private readonly now: () => number

  constructor(private readonly config: WatcherConfig) {
    // eslint-disable-next-line no-restricted-syntax -- intentional bridge: closure defers to global Date.now at call time so vi.useFakeTimers() works regardless of construction order
    this.now = config._now ?? ((): number => Date.now())
    this.startTime = this.now()
    this.alertWindowStart = this.startTime
    this.maxAlerts = config.maxAlerts ?? 10_000
  }

  snapshot(): Readonly<WatcherSnapshot> {
    const now = this.now()

    // Build threat stats
    const byCategory: Record<string, number> = {}
    for (const [cat, count] of this.threatsByCategory) {
      byCategory[cat] = count
    }

    const bySeverity: Record<Severity, number> = {
      low: this.threatsBySeverity.get('low') ?? 0,
      medium: this.threatsBySeverity.get('medium') ?? 0,
      high: this.threatsBySeverity.get('high') ?? 0,
      critical: this.threatsBySeverity.get('critical') ?? 0,
    }

    return Object.freeze({
      uptimeMs: now - this.startTime,
      threats: {
        total: this._totalThreats,
        byCategory,
        bySeverity,
      },
      quarantine: {
        count: this._quarantineCount,
        bytes: this._quarantineBytes,
        capacityPercent: this._quarantineCapacity,
      },
      totalAlerts: this.alerts.length,
      alertsInWindow: this.alertsInCurrentWindow,
      lastAlert: this._lastAlert,
      overloaded: this._overloaded,
      pressure: this._pressure,
      snapshotTime: now,
    })
  }

  recordThreat(category: string, severity: Severity): void {
    this._totalThreats++

    // Update by category
    const catCount = this.threatsByCategory.get(category) ?? 0
    this.threatsByCategory.set(category, catCount + 1)

    // Update by severity
    const sevCount = this.threatsBySeverity.get(severity) ?? 0
    this.threatsBySeverity.set(severity, sevCount + 1)
  }

  updateQuarantine(count: number, bytes: number, maxBytes: number): void {
    this._quarantineCount = count
    this._quarantineBytes = bytes
    this._quarantineCapacity = maxBytes > 0 ? (bytes / maxBytes) * 100 : 0

    // Check high watermark
    if (this._quarantineCapacity >= this.config.quarantineHighWatermark * 100) {
      this.alert({
        type: 'quarantine_high',
        severity: 'warning',
        message: `Quarantine at ${this._quarantineCapacity.toFixed(1)}% capacity`,
        context: { count, bytes, maxBytes },
      })
    }
  }

  alert(alertInput: Omit<Alert, 'id' | 'timestamp'>): boolean {
    const now = this.now()

    // Check if we need to reset the window
    if (now - this.alertWindowStart >= this.config.alertWindowMs) {
      this.alertWindowStart = now
      this.alertsInCurrentWindow = 0
    }

    // Rate limit check
    if (this.alertsInCurrentWindow >= this.config.maxAlertsPerWindow) {
      return false // Rate limited
    }

    // Create alert
    const alert: Alert = {
      ...alertInput,
      id: generateSecureId(),
      timestamp: now,
    }

    this.alerts.push(alert)
    if (this.alerts.length > this.maxAlerts) {
      this.alerts.splice(0, this.alerts.length - this.maxAlerts)
    }
    this.alertsInCurrentWindow++
    this._lastAlert = alert

    return true
  }

  setOverloaded(overloaded: boolean): void {
    const wasOverloaded = this._overloaded
    this._overloaded = overloaded

    // Emit alert on transition to overloaded
    if (overloaded && !wasOverloaded) {
      this.alert({
        type: 'system_overload',
        severity: 'critical',
        message: 'System is overloaded',
      })
    }
  }

  setPressure(pressure: PressureState): void {
    this._pressure = Object.freeze({
      ...pressure,
      signals: Object.freeze({
        ...pressure.signals,
      }),
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Watcher instance.
 *
 * @param config - Watcher configuration
 */
export function createWatcher(config: WatcherConfig): IWatcher {
  return new Watcher(config)
}
