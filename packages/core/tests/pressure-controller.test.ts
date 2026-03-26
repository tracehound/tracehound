import { describe, expect, it } from 'vitest'
import type { HoundResult } from '../src/core/hound-pool.js'
import { HOUND_PRESSURE_ERRORS } from '../src/core/hound-pool.js'
import { PressureController, type PressureThresholds } from '../src/core/pressure-controller.js'
import type { QuarantineStats } from '../src/core/quarantine.js'

function createStats(partial: Partial<QuarantineStats> = {}): QuarantineStats {
  return {
    count: 0,
    bytes: 0,
    droppedCount: 0,
    droppedBytes: 0,
    evictedCount: 0,
    decayedCount: 0,
    archivedCount: 0,
    archiveFailureCount: 0,
    ttlEnabled: false,
    nextExpiryAt: null,
    bySeverity: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
    ...partial,
  }
}

function createHoundResult(partial: Partial<HoundResult> = {}): HoundResult {
  return {
    signature: 'hound-result-signature',
    status: 'processed',
    durationMs: 5,
    processId: 'pid-1',
    ...partial,
  }
}

const THRESHOLDS: PressureThresholds = {
  elevatedWatermark: 0.8,
  criticalWatermark: 0.95,
  recoverToElevatedWatermark: 0.85,
  recoverToNormalWatermark: 0.7,
  recoveryCooldownMs: 100,
}

describe('PressureController', () => {
  it('elevates on archive failure and recovers after cooldown', () => {
    let now = 1_000
    const controller = new PressureController(THRESHOLDS, () => now)

    const transition = controller.observeQuarantine(
      createStats({ archiveFailureCount: 1 }),
      1_000,
      100,
    )

    expect(transition?.current.mode).toBe('elevated')
    expect(transition?.reason).toBe('archive_failure')

    now += 10
    expect(
      controller.observeQuarantine(createStats({ archiveFailureCount: 1 }), 1_000, 100),
    ).toBeNull()
    expect(controller.snapshot().mode).toBe('elevated')

    now += 100
    const recovered = controller.observeQuarantine(
      createStats({ archiveFailureCount: 1 }),
      1_000,
      100,
    )
    expect(recovered?.current.mode).toBe('normal')
    expect(recovered?.reason).toBe('recovered_to_normal')
  })

  it('recovers from critical to elevated before returning to normal', () => {
    let now = 5_000
    const controller = new PressureController(THRESHOLDS, () => now)

    const elevated = controller.observeQuarantine(createStats({ bytes: 850 }), 1_000, 100)
    expect(elevated?.current.mode).toBe('elevated')

    const critical = controller.observeHoundResult(
      createHoundResult({ status: 'timeout' }),
      createStats({ bytes: 850 }),
      1_000,
      100,
    )
    expect(critical?.current.mode).toBe('critical')
    expect(critical?.reason).toBe('hound_pressure')

    now += 101
    const recoveredToElevated = controller.observeHoundRecovery(
      createStats({ bytes: 820 }),
      1_000,
      100,
    )
    expect(recoveredToElevated?.current.mode).toBe('elevated')
    expect(recoveredToElevated?.reason).toBe('recovered_to_elevated')

    const recoveredToNormal = controller.observeQuarantine(createStats({ bytes: 600 }), 1_000, 100)
    expect(recoveredToNormal?.current.mode).toBe('normal')
    expect(recoveredToNormal?.reason).toBe('recovered_to_normal')
  })

  it('uses count saturation when byte capacity is disabled', () => {
    const controller = new PressureController(THRESHOLDS, () => 10_000)

    const transition = controller.observeQuarantine(createStats({ count: 8 }), 0, 10)

    expect(transition?.current.mode).toBe('elevated')
    expect(transition?.current.signals.quarantineCapacityPercent).toBe(80)
  })

  it('treats canonical hound pressure errors as critical signals', () => {
    const controller = new PressureController(THRESHOLDS, () => 20_000)

    const transition = controller.observeHoundResult(
      createHoundResult({
        status: 'error',
        error: HOUND_PRESSURE_ERRORS.POOL_EXHAUSTED,
      }),
      createStats(),
      1_000,
      100,
    )

    expect(transition?.current.mode).toBe('critical')
    expect(transition?.reason).toBe('hound_pressure')
    expect(controller.snapshot().signals.houndPressureEvents).toBe(1)
  })

  it('promotes to critical when dropped evidence increases under pressure', () => {
    const controller = new PressureController(THRESHOLDS, () => 25_000)

    const transition = controller.observeQuarantine(createStats({ droppedCount: 1 }), 1_000, 100)

    expect(transition?.current.mode).toBe('critical')
    expect(transition?.reason).toBe('drop_detected')
    expect(controller.snapshot().signals.overloaded).toBe(true)
  })

  it('ignores non-pressure hound errors and missing error payloads', () => {
    const controller = new PressureController(THRESHOLDS, () => 30_000)

    expect(
      controller.observeHoundResult(
        createHoundResult({
          status: 'error',
          error: 'analysis_failed',
        }),
        createStats(),
        1_000,
        100,
      ),
    ).toBeNull()
    expect(controller.snapshot().signals.houndPressureEvents).toBe(0)

    expect(
      controller.observeHoundResult(
        createHoundResult({
          status: 'error',
          error: undefined,
        }),
        createStats(),
        1_000,
        100,
      ),
    ).toBeNull()
    expect(controller.snapshot().signals.houndPressureEvents).toBe(0)
    expect(controller.snapshot().mode).toBe('normal')
  })
})
