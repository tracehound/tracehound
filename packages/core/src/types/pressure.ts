/**
 * Pressure containment types (RFC-0011 OSS scope).
 */

export type PressureMode = 'normal' | 'elevated' | 'critical'
export type PressureTransitionReason =
  | 'capacity_elevated'
  | 'capacity_critical'
  | 'archive_failure'
  | 'drop_detected'
  | 'hound_pressure'
  | 'recovered_to_elevated'
  | 'recovered_to_normal'

export interface PressureSignals {
  quarantineBytes: number
  quarantineCount: number
  quarantineCapacityPercent: number
  droppedEvents: number
  archiveFailureCount: number
  houndPressureEvents: number
  overloaded: boolean
}

export interface PressureState {
  mode: PressureMode
  archiveSuppressed: boolean
  updatedAt: number
  signals: Readonly<PressureSignals>
}
