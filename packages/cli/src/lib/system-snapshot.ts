import { createHmac, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_SNAPSHOT_PATH = join(tmpdir(), 'tracehound', 'system-snapshot.json')
const DEFAULT_MAX_SNAPSHOT_AGE_MS = 5_000

export interface CliSystemSnapshot {
  generatedAt: number
  systemHealth: 'healthy' | 'degraded' | 'critical'
  agent: {
    totalIntercepts: number
    cleanCount: number
    rateLimitedCount: number
    validationFailures: number
    ignoredCount: number
    quarantinedCount: number
    errorCount: number
    coordinationFallbackCount: number
    coordinationWarningCount: number
    membraneRejectionCount: number
  }
  quarantine: {
    count: number
    bytes: number
    droppedCount: number
    droppedBytes: number
    bySeverity: { critical: number; high: number; medium: number; low: number }
  }
  quarantineMaxBytes: number
  watcher: {
    uptimeMs: number
    threats: {
      total: number
      byCategory: Record<string, number>
      bySeverity: { critical: number; high: number; medium: number; low: number }
    }
    totalAlerts: number
    alertsInWindow: number
    lastAlert: unknown
    overloaded: boolean
    snapshotTime: number
    quarantine: {
      count: number
      bytes: number
      capacityPercent: number
    }
  }
  houndPool: {
    activeProcesses: number
    totalProcesses: number
    totalActivations: number
    totalTimeouts: number
    totalErrors: number
    avgProcessingMs: number
  }
  rateLimiter: {
    sources: number
    blocked: number
    totalChecks: number
    totalRejections: number
    totalEvictions: number
  }
}

interface SignedSnapshot {
  version: 1
  algorithm: 'HMAC-SHA256'
  payload: CliSystemSnapshot
  signature: string
}

export type CliSnapshotErrorCode = 'NO_INSTANCE' | 'INTEGRITY_VIOLATION'

export type CliSnapshotLoadResult =
  | {
      ok: true
      snapshot: CliSystemSnapshot
      path: string
    }
  | {
      ok: false
      code: CliSnapshotErrorCode
      path: string
    }

export function loadSystemSnapshot(): CliSnapshotLoadResult {
  const path = resolveSnapshotPath()

  if (!existsSync(path)) {
    return { ok: false, code: 'NO_INSTANCE', path }
  }

  const secret = resolveSnapshotSecret()
  const maxSnapshotAgeMs = resolveSnapshotMaxAgeMs()
  if (!secret) {
    return { ok: false, code: 'INTEGRITY_VIOLATION', path }
  }

  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as unknown

    if (!isSignedSnapshot(parsed)) {
      return { ok: false, code: 'INTEGRITY_VIOLATION', path }
    }

    const payloadText = JSON.stringify(parsed.payload)
    const expected = createHmac('sha256', secret).update(payloadText).digest('hex')
    if (!constantTimeHexEqual(expected, parsed.signature)) {
      return { ok: false, code: 'INTEGRITY_VIOLATION', path }
    }
    if (isSnapshotStale(parsed.payload.generatedAt, maxSnapshotAgeMs)) {
      return { ok: false, code: 'NO_INSTANCE', path }
    }

    return {
      ok: true,
      snapshot: parsed.payload,
      path,
    }
  } catch {
    return { ok: false, code: 'INTEGRITY_VIOLATION', path }
  }
}

function resolveSnapshotPath(): string {
  const envPath = process.env.TRACEHOUND_SYSTEM_SNAPSHOT_PATH
  if (typeof envPath === 'string' && envPath.length > 0) {
    return envPath
  }

  return DEFAULT_SNAPSHOT_PATH
}

function resolveSnapshotSecret(): string | null {
  const secret = process.env.TRACEHOUND_SNAPSHOT_SECRET
  if (typeof secret === 'string' && secret.length > 0) {
    return secret
  }

  return null
}

function resolveSnapshotMaxAgeMs(): number {
  const raw = process.env.TRACEHOUND_SNAPSHOT_MAX_AGE_MS
  if (typeof raw !== 'string' || raw.length === 0) {
    return DEFAULT_MAX_SNAPSHOT_AGE_MS
  }

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_SNAPSHOT_AGE_MS
  }

  return Math.floor(parsed)
}

function isSnapshotStale(generatedAt: number, maxAgeMs: number): boolean {
  return Date.now() - generatedAt > maxAgeMs
}

function constantTimeHexEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8')
  const rightBuffer = Buffer.from(right, 'utf8')

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

function isSignedSnapshot(value: unknown): value is SignedSnapshot {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<SignedSnapshot>
  if (candidate.version !== 1 || candidate.algorithm !== 'HMAC-SHA256') {
    return false
  }
  if (typeof candidate.signature !== 'string' || candidate.signature.length === 0) {
    return false
  }

  return isSnapshotPayload(candidate.payload)
}

function isSnapshotPayload(value: unknown): value is CliSystemSnapshot {
  if (!isRecord(value)) {
    return false
  }

  const snapshot = value as {
    generatedAt?: unknown
    systemHealth?: unknown
    quarantineMaxBytes?: unknown
    agent?: unknown
    quarantine?: unknown
    watcher?: unknown
    houndPool?: unknown
    rateLimiter?: unknown
  }

  if (!isNonNegativeFiniteNumber(snapshot.generatedAt)) {
    return false
  }
  if (!isSystemHealth(snapshot.systemHealth)) {
    return false
  }
  if (!isNonNegativeInteger(snapshot.quarantineMaxBytes)) {
    return false
  }
  if (!isAgentStats(snapshot.agent)) {
    return false
  }
  if (!isQuarantineStats(snapshot.quarantine)) {
    return false
  }
  if (!isWatcherSnapshot(snapshot.watcher)) {
    return false
  }
  if (!isHoundPoolStats(snapshot.houndPool)) {
    return false
  }
  if (!isRateLimiterStats(snapshot.rateLimiter)) {
    return false
  }

  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSystemHealth(value: unknown): value is CliSystemSnapshot['systemHealth'] {
  return value === 'healthy' || value === 'degraded' || value === 'critical'
}

function isAgentStats(value: unknown): value is CliSystemSnapshot['agent'] {
  if (!isRecord(value)) {
    return false
  }

  const stats = value as {
    totalIntercepts?: unknown
    cleanCount?: unknown
    rateLimitedCount?: unknown
    validationFailures?: unknown
    ignoredCount?: unknown
    quarantinedCount?: unknown
    errorCount?: unknown
    coordinationFallbackCount?: unknown
    coordinationWarningCount?: unknown
    membraneRejectionCount?: unknown
  }

  return (
    isNonNegativeInteger(stats.totalIntercepts) &&
    isNonNegativeInteger(stats.cleanCount) &&
    isNonNegativeInteger(stats.rateLimitedCount) &&
    isNonNegativeInteger(stats.validationFailures) &&
    isNonNegativeInteger(stats.ignoredCount) &&
    isNonNegativeInteger(stats.quarantinedCount) &&
    isNonNegativeInteger(stats.errorCount) &&
    isNonNegativeInteger(stats.coordinationFallbackCount) &&
    isNonNegativeInteger(stats.coordinationWarningCount) &&
    isNonNegativeInteger(stats.membraneRejectionCount)
  )
}

function isQuarantineStats(value: unknown): value is CliSystemSnapshot['quarantine'] {
  if (!isRecord(value)) {
    return false
  }

  const stats = value as {
    count?: unknown
    bytes?: unknown
    droppedCount?: unknown
    droppedBytes?: unknown
    bySeverity?: unknown
  }

  return (
    isNonNegativeInteger(stats.count) &&
    isNonNegativeInteger(stats.bytes) &&
    isNonNegativeInteger(stats.droppedCount) &&
    isNonNegativeInteger(stats.droppedBytes) &&
    isSeverityCounters(stats.bySeverity)
  )
}

function isWatcherSnapshot(value: unknown): value is CliSystemSnapshot['watcher'] {
  if (!isRecord(value)) {
    return false
  }

  const snapshot = value as {
    uptimeMs?: unknown
    threats?: unknown
    totalAlerts?: unknown
    alertsInWindow?: unknown
    overloaded?: unknown
    snapshotTime?: unknown
    quarantine?: unknown
  }

  if (!isRecord(snapshot.threats) || !isRecord(snapshot.quarantine)) {
    return false
  }

  const threats = snapshot.threats as {
    total?: unknown
    byCategory?: unknown
    bySeverity?: unknown
  }
  const quarantine = snapshot.quarantine as {
    count?: unknown
    bytes?: unknown
    capacityPercent?: unknown
  }

  return (
    isNonNegativeInteger(snapshot.uptimeMs) &&
    isNonNegativeInteger(threats.total) &&
    isNumericRecord(threats.byCategory) &&
    isSeverityCounters(threats.bySeverity) &&
    isNonNegativeInteger(snapshot.totalAlerts) &&
    isNonNegativeInteger(snapshot.alertsInWindow) &&
    typeof snapshot.overloaded === 'boolean' &&
    isNonNegativeFiniteNumber(snapshot.snapshotTime) &&
    isNonNegativeInteger(quarantine.count) &&
    isNonNegativeInteger(quarantine.bytes) &&
    isNonNegativeFiniteNumber(quarantine.capacityPercent)
  )
}

function isHoundPoolStats(value: unknown): value is CliSystemSnapshot['houndPool'] {
  if (!isRecord(value)) {
    return false
  }

  const stats = value as {
    activeProcesses?: unknown
    totalProcesses?: unknown
    totalActivations?: unknown
    totalTimeouts?: unknown
    totalErrors?: unknown
    avgProcessingMs?: unknown
  }

  return (
    isNonNegativeInteger(stats.activeProcesses) &&
    isNonNegativeInteger(stats.totalProcesses) &&
    isNonNegativeInteger(stats.totalActivations) &&
    isNonNegativeInteger(stats.totalTimeouts) &&
    isNonNegativeInteger(stats.totalErrors) &&
    isNonNegativeFiniteNumber(stats.avgProcessingMs)
  )
}

function isRateLimiterStats(value: unknown): value is CliSystemSnapshot['rateLimiter'] {
  if (!isRecord(value)) {
    return false
  }

  const stats = value as {
    sources?: unknown
    blocked?: unknown
    totalChecks?: unknown
    totalRejections?: unknown
    totalEvictions?: unknown
  }

  return (
    isNonNegativeInteger(stats.sources) &&
    isNonNegativeInteger(stats.blocked) &&
    isNonNegativeInteger(stats.totalChecks) &&
    isNonNegativeInteger(stats.totalRejections) &&
    isNonNegativeInteger(stats.totalEvictions)
  )
}

function isSeverityCounters(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }

  const counters = value as {
    critical?: unknown
    high?: unknown
    medium?: unknown
    low?: unknown
  }

  return (
    isNonNegativeInteger(counters.critical) &&
    isNonNegativeInteger(counters.high) &&
    isNonNegativeInteger(counters.medium) &&
    isNonNegativeInteger(counters.low)
  )
}

function isNumericRecord(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }

  for (const entryValue of Object.values(value)) {
    if (!isNonNegativeInteger(entryValue)) {
      return false
    }
  }

  return true
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return isNonNegativeFiniteNumber(value) && Number.isInteger(value)
}
