/**
 * Security State - Unified substrate for all security-related state.
 *
 * DESIGN PRINCIPLES:
 * - Immutable snapshots for external consumers
 * - Event-driven recording (no polling)
 * - Time-series history for ThreatLedger
 * - Zero-copy where possible
 */

import type { Severity } from '../types/common.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Threat statistics.
 */
export interface ThreatStats {
  total: number
  byCategory: Record<string, number>
  bySeverity: Record<Severity, number>
}

/**
 * Quarantine statistics.
 */
export interface QuarantineStateStats {
  count: number
  bytes: number
  capacityPercent: number
}

/**
 * Rate limit statistics.
 */
export interface RateLimitStats {
  activeWindows: number
  blockedSources: number
}

/**
 * License state.
 */
export interface LicenseState {
  tier: 'starter' | 'pro' | 'enterprise'
  status: 'valid' | 'expired' | 'grace' | 'invalid' | 'none'
  daysRemaining?: number | undefined
}

/**
 * Complete security snapshot.
 */
export interface SecuritySnapshot {
  /** Snapshot timestamp */
  timestamp: number
  /** System uptime in ms */
  uptimeMs: number
  /** Threat statistics */
  threats: ThreatStats
  /** Quarantine statistics */
  quarantine: QuarantineStateStats
  /** Rate limit statistics */
  rateLimits: RateLimitStats
  /** License state */
  license: LicenseState
  /** System health */
  health: 'healthy' | 'degraded' | 'critical'
}

/**
 * History entry for time-series tracking.
 */
export interface SecurityHistoryEntry {
  timestamp: number
  type: 'threat' | 'evidence' | 'eviction' | 'rate_limit' | 'panic'
  data: Record<string, unknown>
}

/**
 * Security State configuration.
 */
export interface SecurityStateConfig {
  /** Maximum history entries to retain */
  maxHistorySize?: number
  /** Quarantine max bytes (for capacity calculation) */
  quarantineMaxBytes?: number
}

/**
 * Security State interface.
 */
export interface ISecurityState {
  /**
   * Get immutable snapshot of current state.
   */
  snapshot(): Readonly<SecuritySnapshot>

  /**
   * Record a threat detection.
   */
  recordThreat(category: string, severity: Severity): void

  /**
   * Record evidence quarantine.
   */
  recordEvidence(signature: string, size: number, severity: Severity): void

  /**
   * Record evidence eviction.
   */
  recordEviction(signature: string, reason: 'capacity' | 'policy' | 'manual'): void

  /**
   * Record rate limit event.
   */
  recordRateLimit(source: string, blocked: boolean): void

  /**
   * Record system panic.
   */
  recordPanic(level: 'warning' | 'critical' | 'fatal', reason: string): void

  /**
   * Update license state.
   */
  updateLicense(
    tier: LicenseState['tier'],
    status: LicenseState['status'],
    daysRemaining?: number,
  ): void

  /**
   * Update quarantine stats (called by Quarantine).
   */
  updateQuarantine(count: number, bytes: number): void

  /**
   * Update rate limit stats (called by RateLimiter).
   */
  updateRateLimits(activeWindows: number, blockedSources: number): void

  /**
   * Get history entries (for ThreatLedger).
   */
  readonly history: readonly SecurityHistoryEntry[]

  /**
   * Get current stats.
   */
  readonly stats: SecurityStateStats
}

/**
 * Security State statistics.
 */
export interface SecurityStateStats {
  historySize: number
  oldestEntry: number | null
  newestEntry: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_HISTORY = 10_000

/**
 * Security State implementation.
 */
export class SecurityState implements ISecurityState {
  private readonly config: Required<SecurityStateConfig>
  private readonly startTime = Date.now()

  // Threat tracking
  private _threatTotal = 0
  private _threatsByCategory = new Map<string, number>()
  private _threatsBySeverity = new Map<Severity, number>()

  // Quarantine tracking
  private _quarantineCount = 0
  private _quarantineBytes = 0

  // Rate limit tracking
  private _activeWindows = 0
  private _blockedSources = 0

  // License tracking
  private _licenseTier: LicenseState['tier'] = 'starter'
  private _licenseStatus: LicenseState['status'] = 'none'
  private _licenseDaysRemaining: number | undefined = undefined

  // History
  private _history: SecurityHistoryEntry[] = []

  constructor(config: SecurityStateConfig = {}) {
    this.config = {
      maxHistorySize: config.maxHistorySize ?? DEFAULT_MAX_HISTORY,
      quarantineMaxBytes: config.quarantineMaxBytes ?? 100_000_000,
    }
  }

  snapshot(): Readonly<SecuritySnapshot> {
    const now = Date.now()

    const bySeverity: Record<Severity, number> = {
      low: this._threatsBySeverity.get('low') ?? 0,
      medium: this._threatsBySeverity.get('medium') ?? 0,
      high: this._threatsBySeverity.get('high') ?? 0,
      critical: this._threatsBySeverity.get('critical') ?? 0,
    }

    const byCategory: Record<string, number> = {}
    for (const [cat, count] of this._threatsByCategory) {
      byCategory[cat] = count
    }

    const capacityPercent =
      this.config.quarantineMaxBytes > 0
        ? (this._quarantineBytes / this.config.quarantineMaxBytes) * 100
        : 0

    // Determine health
    let health: SecuritySnapshot['health'] = 'healthy'
    if (capacityPercent > 90 || this._licenseStatus === 'expired') {
      health = 'critical'
    } else if (capacityPercent > 70 || this._licenseStatus === 'grace') {
      health = 'degraded'
    }

    return Object.freeze({
      timestamp: now,
      uptimeMs: now - this.startTime,
      threats: {
        total: this._threatTotal,
        byCategory,
        bySeverity,
      },
      quarantine: {
        count: this._quarantineCount,
        bytes: this._quarantineBytes,
        capacityPercent,
      },
      rateLimits: {
        activeWindows: this._activeWindows,
        blockedSources: this._blockedSources,
      },
      license: {
        tier: this._licenseTier,
        status: this._licenseStatus,
        daysRemaining: this._licenseDaysRemaining,
      },
      health,
    })
  }

  recordThreat(category: string, severity: Severity): void {
    this._threatTotal++
    this._threatsByCategory.set(category, (this._threatsByCategory.get(category) ?? 0) + 1)
    this._threatsBySeverity.set(severity, (this._threatsBySeverity.get(severity) ?? 0) + 1)

    this.addHistory('threat', { category, severity })
  }

  recordEvidence(signature: string, size: number, severity: Severity): void {
    this.addHistory('evidence', { signature, size, severity })
  }

  recordEviction(signature: string, reason: 'capacity' | 'policy' | 'manual'): void {
    this.addHistory('eviction', { signature, reason })
  }

  recordRateLimit(source: string, blocked: boolean): void {
    if (blocked) {
      this._blockedSources++
    }
    this.addHistory('rate_limit', { source, blocked })
  }

  recordPanic(level: 'warning' | 'critical' | 'fatal', reason: string): void {
    this.addHistory('panic', { level, reason })
  }

  updateLicense(
    tier: LicenseState['tier'],
    status: LicenseState['status'],
    daysRemaining?: number,
  ): void {
    this._licenseTier = tier
    this._licenseStatus = status
    this._licenseDaysRemaining = daysRemaining
  }

  updateQuarantine(count: number, bytes: number): void {
    this._quarantineCount = count
    this._quarantineBytes = bytes
  }

  updateRateLimits(activeWindows: number, blockedSources: number): void {
    this._activeWindows = activeWindows
    this._blockedSources = blockedSources
  }

  get history(): readonly SecurityHistoryEntry[] {
    return this._history
  }

  get stats(): SecurityStateStats {
    return {
      historySize: this._history.length,
      oldestEntry: this._history.length > 0 ? this._history[0]!.timestamp : null,
      newestEntry:
        this._history.length > 0 ? this._history[this._history.length - 1]!.timestamp : null,
    }
  }

  // ─── Private Methods ─────────────────────────────────────────────────────────

  private addHistory(type: SecurityHistoryEntry['type'], data: Record<string, unknown>): void {
    this._history.push({
      timestamp: Date.now(),
      type,
      data,
    })

    // Prune if exceeds max
    if (this._history.length > this.config.maxHistorySize) {
      this._history.shift()
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Security State instance.
 */
export function createSecurityState(config: SecurityStateConfig = {}): ISecurityState {
  return new SecurityState(config)
}
