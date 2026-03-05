import { createHmac, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_SNAPSHOT_PATH = join(tmpdir(), 'tracehound', 'system-snapshot.json')

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
  const secret = resolveSnapshotSecret()

  if (!secret) {
    return { ok: false, code: 'INTEGRITY_VIOLATION', path }
  }

  if (!existsSync(path)) {
    return { ok: false, code: 'NO_INSTANCE', path }
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
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const snapshot = value as Partial<CliSystemSnapshot>
  if (typeof snapshot.generatedAt !== 'number' || !Number.isFinite(snapshot.generatedAt)) {
    return false
  }
  if (
    snapshot.systemHealth !== 'healthy' &&
    snapshot.systemHealth !== 'degraded' &&
    snapshot.systemHealth !== 'critical'
  ) {
    return false
  }

  return Boolean(
    snapshot.agent &&
      snapshot.quarantine &&
      typeof snapshot.quarantineMaxBytes === 'number' &&
      snapshot.watcher &&
      snapshot.houndPool &&
      snapshot.rateLimiter,
  )
}
