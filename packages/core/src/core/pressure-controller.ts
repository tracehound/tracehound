import type { PressureMode, PressureState, PressureTransitionReason } from '../types/pressure.js'
import { isHoundPressureError, type HoundResult } from './hound-pool.js'
import type { QuarantineStats } from './quarantine.js'

export interface PressureThresholds {
  elevatedWatermark: number
  criticalWatermark: number
  recoverToElevatedWatermark: number
  recoverToNormalWatermark: number
  recoveryCooldownMs: number
}

export interface PressureTransition {
  previous: PressureState
  current: PressureState
  reason: PressureTransitionReason
}

export class PressureController {
  private state: PressureState
  private lastDroppedCount = 0
  private lastArchiveFailureCount = 0
  private lastDropAt: number | null = null
  private lastArchiveFailureAt: number | null = null
  private lastHoundPressureAt: number | null = null
  private houndPressureEvents = 0
  private readonly now: () => number

  constructor(private readonly thresholds: PressureThresholds, now?: () => number) {
    // eslint-disable-next-line no-restricted-syntax -- intentional bridge: closure defers to global Date.now at call time so vi.useFakeTimers() works regardless of construction order
    this.now = now ?? ((): number => Date.now())
    this.state = freezePressureState({
      mode: 'normal',
      archiveSuppressed: false,
      updatedAt: this.now(),
      signals: {
        quarantineBytes: 0,
        quarantineCount: 0,
        quarantineCapacityPercent: 0,
        droppedEvents: 0,
        archiveFailureCount: 0,
        houndPressureEvents: 0,
        overloaded: false,
      },
    })
  }

  snapshot(): PressureState {
    return this.state
  }

  observeQuarantine(
    stats: Readonly<QuarantineStats>,
    maxBytes: number,
    maxCount: number,
  ): PressureTransition | null {
    const now = this.now()
    const dropDelta = stats.droppedCount > this.lastDroppedCount
    const archiveFailureDelta = stats.archiveFailureCount > this.lastArchiveFailureCount

    if (dropDelta) {
      this.lastDropAt = now
    }
    if (archiveFailureDelta) {
      this.lastArchiveFailureAt = now
    }

    this.lastDroppedCount = stats.droppedCount
    this.lastArchiveFailureCount = stats.archiveFailureCount

    return this.updateState(stats, maxBytes, maxCount, now, {
      acuteDrop: dropDelta,
    })
  }

  observeHoundResult(
    result: Readonly<HoundResult>,
    stats: Readonly<QuarantineStats>,
    maxBytes: number,
    maxCount: number,
  ): PressureTransition | null {
    const now = this.now()

    if (isHoundPressureSignal(result)) {
      this.houndPressureEvents++
      this.lastHoundPressureAt = now
    }

    return this.updateState(stats, maxBytes, maxCount, now)
  }

  observeHoundRecovery(
    stats: Readonly<QuarantineStats>,
    maxBytes: number,
    maxCount: number,
  ): PressureTransition | null {
    return this.updateState(stats, maxBytes, maxCount, this.now())
  }

  private updateState(
    stats: Readonly<QuarantineStats>,
    maxBytes: number,
    maxCount: number,
    now: number,
    runtimeSignals: {
      acuteDrop?: boolean
    } = {},
  ): PressureTransition | null {
    const previous = this.state
    const next = this.computeMode(previous.mode, stats, maxBytes, maxCount, now)
    const capacityRatio = resolveCapacityRatio(stats, maxBytes, maxCount)
    const capacityPercent = capacityRatio * 100
    const overloaded =
      capacityRatio >= this.thresholds.criticalWatermark || runtimeSignals.acuteDrop === true

    const current = freezePressureState({
      mode: next.mode,
      archiveSuppressed: next.mode === 'critical',
      updatedAt: now,
      signals: {
        quarantineBytes: stats.bytes,
        quarantineCount: stats.count,
        quarantineCapacityPercent: capacityPercent,
        droppedEvents: stats.droppedCount,
        archiveFailureCount: stats.archiveFailureCount,
        houndPressureEvents: this.houndPressureEvents,
        overloaded,
      },
    })

    this.state = current

    if (previous.mode === current.mode) {
      return null
    }

    return {
      previous,
      current,
      reason: next.reason,
    }
  }

  private computeMode(
    previousMode: PressureMode,
    stats: Readonly<QuarantineStats>,
    maxBytes: number,
    maxCount: number,
    now: number,
  ): {
    mode: PressureMode
    reason: PressureTransition['reason']
  } {
    const capacityRatio = resolveCapacityRatio(stats, maxBytes, maxCount)
    const recentDrop = this.isWithinCooldown(this.lastDropAt, now)
    const recentArchiveFailure = this.isWithinCooldown(this.lastArchiveFailureAt, now)
    const recentHoundPressure = this.isWithinCooldown(this.lastHoundPressureAt, now)

    if (previousMode === 'critical') {
      if (
        capacityRatio < this.thresholds.recoverToElevatedWatermark &&
        !recentDrop &&
        !recentHoundPressure
      ) {
        if (capacityRatio < this.thresholds.recoverToNormalWatermark && !recentArchiveFailure) {
          return { mode: 'normal', reason: 'recovered_to_normal' }
        }

        return { mode: 'elevated', reason: 'recovered_to_elevated' }
      }

      return { mode: 'critical', reason: 'capacity_critical' }
    }

    if (capacityRatio >= this.thresholds.criticalWatermark) {
      return { mode: 'critical', reason: 'capacity_critical' }
    }
    if (recentDrop) {
      return { mode: 'critical', reason: 'drop_detected' }
    }
    if (recentHoundPressure) {
      return { mode: 'critical', reason: 'hound_pressure' }
    }

    if (previousMode === 'elevated') {
      if (capacityRatio < this.thresholds.recoverToNormalWatermark && !recentArchiveFailure) {
        return { mode: 'normal', reason: 'recovered_to_normal' }
      }

      return { mode: 'elevated', reason: 'capacity_elevated' }
    }

    if (capacityRatio >= this.thresholds.elevatedWatermark) {
      return { mode: 'elevated', reason: 'capacity_elevated' }
    }
    if (recentArchiveFailure) {
      return { mode: 'elevated', reason: 'archive_failure' }
    }

    return { mode: 'normal', reason: 'recovered_to_normal' }
  }

  private isWithinCooldown(timestamp: number | null, now: number): boolean {
    if (timestamp === null) {
      return false
    }

    return now - timestamp < this.thresholds.recoveryCooldownMs
  }
}

function resolveCapacityRatio(
  stats: Readonly<QuarantineStats>,
  maxBytes: number,
  maxCount: number,
): number {
  const byteRatio = maxBytes > 0 ? stats.bytes / maxBytes : 0
  const countRatio = maxCount > 0 ? stats.count / maxCount : 0
  return Math.max(byteRatio, countRatio)
}

function freezePressureState(state: PressureState): PressureState {
  return Object.freeze({
    ...state,
    signals: Object.freeze({
      ...state.signals,
    }),
  })
}

function isHoundPressureSignal(result: Readonly<HoundResult>): boolean {
  if (result.status === 'timeout') {
    return true
  }

  if (result.status !== 'error' || !result.error) {
    return false
  }

  return isHoundPressureError(result.error)
}
