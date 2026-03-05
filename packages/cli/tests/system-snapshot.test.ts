import { createHmac } from 'node:crypto'
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { SystemSnapshot } from '@tracehound/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadSystemSnapshot } from '../src/lib/system-snapshot.js'

const SNAPSHOT_SECRET = 'tracehound-cli-test-snapshot-secret'

function createFixtureSnapshot(generatedAt: number): SystemSnapshot {
  return {
    generatedAt,
    systemHealth: 'degraded',
    agent: {
      totalIntercepts: 12,
      cleanCount: 3,
      rateLimitedCount: 2,
      validationFailures: 1,
      ignoredCount: 1,
      quarantinedCount: 5,
      errorCount: 0,
      coordinationFallbackCount: 0,
      coordinationWarningCount: 0,
      membraneRejectionCount: 0,
    },
    quarantine: {
      count: 4,
      bytes: 4096,
      droppedCount: 1,
      droppedBytes: 512,
      bySeverity: {
        critical: 1,
        high: 1,
        medium: 1,
        low: 1,
      },
    },
    quarantineMaxBytes: 8192,
    watcher: {
      uptimeMs: 65_000,
      threats: {
        total: 8,
        byCategory: {
          injection: 3,
          ddos: 2,
          malware: 3,
        },
        bySeverity: {
          critical: 1,
          high: 2,
          medium: 3,
          low: 2,
        },
      },
      totalAlerts: 2,
      alertsInWindow: 1,
      lastAlert: null,
      overloaded: false,
      snapshotTime: generatedAt,
      quarantine: {
        count: 4,
        bytes: 4096,
        capacityPercent: 50,
      },
    },
    houndPool: {
      activeProcesses: 1,
      totalProcesses: 2,
      totalActivations: 10,
      totalTimeouts: 0,
      totalErrors: 0,
      avgProcessingMs: 12.4,
    },
    rateLimiter: {
      sources: 7,
      blocked: 2,
      totalChecks: 100,
      totalRejections: 2,
      totalEvictions: 0,
    },
  }
}

function writeFixtureSnapshotToDisk(snapshot: SystemSnapshot, path: string, secret: string): void {
  const payloadText = JSON.stringify(snapshot)
  const signature = createHmac('sha256', secret).update(payloadText).digest('hex')
  const signed = JSON.stringify({
    version: 1,
    algorithm: 'HMAC-SHA256',
    payload: snapshot,
    signature,
  })
  const tmpPath = `${path}.tmp`

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(tmpPath, signed, 'utf8')
  renameSync(tmpPath, path)
}

describe('system snapshot freshness', () => {
  let previousSnapshotPath: string | undefined
  let previousSnapshotSecret: string | undefined
  let previousSnapshotMaxAgeMs: string | undefined
  let previousSnapshotMaxFutureSkewMs: string | undefined
  let fixtureDir = ''
  let snapshotPath = ''

  beforeEach(() => {
    vi.useFakeTimers()
    fixtureDir = mkdtempSync(join(tmpdir(), 'tracehound-cli-system-snapshot-'))
    snapshotPath = join(fixtureDir, 'system-snapshot.json')

    previousSnapshotPath = process.env.TRACEHOUND_SYSTEM_SNAPSHOT_PATH
    previousSnapshotSecret = process.env.TRACEHOUND_SNAPSHOT_SECRET
    previousSnapshotMaxAgeMs = process.env.TRACEHOUND_SNAPSHOT_MAX_AGE_MS
    previousSnapshotMaxFutureSkewMs = process.env.TRACEHOUND_SNAPSHOT_MAX_FUTURE_SKEW_MS

    process.env.TRACEHOUND_SYSTEM_SNAPSHOT_PATH = snapshotPath
    process.env.TRACEHOUND_SNAPSHOT_SECRET = SNAPSHOT_SECRET
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(fixtureDir, { recursive: true, force: true })

    if (previousSnapshotPath === undefined) {
      delete process.env.TRACEHOUND_SYSTEM_SNAPSHOT_PATH
    } else {
      process.env.TRACEHOUND_SYSTEM_SNAPSHOT_PATH = previousSnapshotPath
    }

    if (previousSnapshotSecret === undefined) {
      delete process.env.TRACEHOUND_SNAPSHOT_SECRET
    } else {
      process.env.TRACEHOUND_SNAPSHOT_SECRET = previousSnapshotSecret
    }

    if (previousSnapshotMaxAgeMs === undefined) {
      delete process.env.TRACEHOUND_SNAPSHOT_MAX_AGE_MS
    } else {
      process.env.TRACEHOUND_SNAPSHOT_MAX_AGE_MS = previousSnapshotMaxAgeMs
    }

    if (previousSnapshotMaxFutureSkewMs === undefined) {
      delete process.env.TRACEHOUND_SNAPSHOT_MAX_FUTURE_SKEW_MS
    } else {
      process.env.TRACEHOUND_SNAPSHOT_MAX_FUTURE_SKEW_MS = previousSnapshotMaxFutureSkewMs
    }
  })

  it('should load snapshot when generatedAt is within freshness window', () => {
    const now = new Date('2026-03-05T10:00:00.000Z')
    vi.setSystemTime(now)
    writeFixtureSnapshotToDisk(createFixtureSnapshot(now.getTime()), snapshotPath, SNAPSHOT_SECRET)

    const result = loadSystemSnapshot()

    expect(result.ok).toBe(true)
  })

  it('should reject stale snapshot as NO_INSTANCE with default max age', () => {
    const now = new Date('2026-03-05T10:00:00.000Z')
    vi.setSystemTime(now)
    writeFixtureSnapshotToDisk(
      createFixtureSnapshot(now.getTime() - 5_001),
      snapshotPath,
      SNAPSHOT_SECRET,
    )

    const result = loadSystemSnapshot()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('NO_INSTANCE')
  })

  it('should reject future-dated snapshot as INTEGRITY_VIOLATION by default', () => {
    const now = new Date('2026-03-05T10:00:00.000Z')
    vi.setSystemTime(now)
    writeFixtureSnapshotToDisk(
      createFixtureSnapshot(now.getTime() + 5_001),
      snapshotPath,
      SNAPSHOT_SECRET,
    )

    const result = loadSystemSnapshot()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INTEGRITY_VIOLATION')
  })

  it('should honor TRACEHOUND_SNAPSHOT_MAX_FUTURE_SKEW_MS override', () => {
    const now = new Date('2026-03-05T10:00:00.000Z')
    vi.setSystemTime(now)
    process.env.TRACEHOUND_SNAPSHOT_MAX_FUTURE_SKEW_MS = '10000'
    writeFixtureSnapshotToDisk(
      createFixtureSnapshot(now.getTime() + 6_000),
      snapshotPath,
      SNAPSHOT_SECRET,
    )

    const result = loadSystemSnapshot()
    expect(result.ok).toBe(true)
  })

  it('should honor TRACEHOUND_SNAPSHOT_MAX_AGE_MS override', () => {
    const now = new Date('2026-03-05T10:00:00.000Z')
    vi.setSystemTime(now)
    process.env.TRACEHOUND_SNAPSHOT_MAX_AGE_MS = '100'
    writeFixtureSnapshotToDisk(createFixtureSnapshot(now.getTime() - 101), snapshotPath, SNAPSHOT_SECRET)

    const result = loadSystemSnapshot()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('NO_INSTANCE')
  })

  it('should return NO_INSTANCE when snapshot file is missing even if secret is missing', () => {
    delete process.env.TRACEHOUND_SNAPSHOT_SECRET

    const result = loadSystemSnapshot()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('NO_INSTANCE')
  })

  it('should return INTEGRITY_VIOLATION when snapshot exists but secret is missing', () => {
    const now = new Date('2026-03-05T10:00:00.000Z')
    vi.setSystemTime(now)
    writeFixtureSnapshotToDisk(createFixtureSnapshot(now.getTime()), snapshotPath, SNAPSHOT_SECRET)
    delete process.env.TRACEHOUND_SNAPSHOT_SECRET

    const result = loadSystemSnapshot()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INTEGRITY_VIOLATION')
  })

  it('should return INTEGRITY_VIOLATION when snapshot json is malformed', () => {
    writeFileSync(snapshotPath, '{', 'utf8')

    const result = loadSystemSnapshot()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INTEGRITY_VIOLATION')
  })

  it('should return INTEGRITY_VIOLATION when signature is mismatched', () => {
    const now = new Date('2026-03-05T10:00:00.000Z')
    vi.setSystemTime(now)
    writeFixtureSnapshotToDisk(createFixtureSnapshot(now.getTime()), snapshotPath, 'other-secret')

    const result = loadSystemSnapshot()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INTEGRITY_VIOLATION')
  })

  it('should fallback to default max age when env override is invalid', () => {
    const now = new Date('2026-03-05T10:00:00.000Z')
    vi.setSystemTime(now)
    process.env.TRACEHOUND_SNAPSHOT_MAX_AGE_MS = 'not-a-number'
    writeFixtureSnapshotToDisk(
      createFixtureSnapshot(now.getTime() - 5_001),
      snapshotPath,
      SNAPSHOT_SECRET,
    )

    const result = loadSystemSnapshot()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('NO_INSTANCE')
  })

  it('should treat non-positive max age override as default value', () => {
    const now = new Date('2026-03-05T10:00:00.000Z')
    vi.setSystemTime(now)
    process.env.TRACEHOUND_SNAPSHOT_MAX_AGE_MS = '0'
    writeFixtureSnapshotToDisk(
      createFixtureSnapshot(now.getTime() - 5_001),
      snapshotPath,
      SNAPSHOT_SECRET,
    )

    const result = loadSystemSnapshot()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('NO_INSTANCE')
  })

  it('should reject envelope with invalid signature metadata', () => {
    const now = new Date('2026-03-05T10:00:00.000Z')
    vi.setSystemTime(now)
    writeFileSync(
      snapshotPath,
      JSON.stringify({
        version: 1,
        algorithm: 'HMAC-SHA256',
        payload: createFixtureSnapshot(now.getTime()),
        signature: '',
      }),
      'utf8',
    )

    const result = loadSystemSnapshot()
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INTEGRITY_VIOLATION')
  })

  it('should reject envelope when version or algorithm is invalid', () => {
    const now = new Date('2026-03-05T10:00:00.000Z')
    vi.setSystemTime(now)

    writeFileSync(
      snapshotPath,
      JSON.stringify({
        version: 2,
        algorithm: 'HMAC-SHA256',
        payload: createFixtureSnapshot(now.getTime()),
        signature: 'x',
      }),
      'utf8',
    )
    let result = loadSystemSnapshot()
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INTEGRITY_VIOLATION')

    writeFileSync(
      snapshotPath,
      JSON.stringify({
        version: 1,
        algorithm: 'HMAC-MD5',
        payload: createFixtureSnapshot(now.getTime()),
        signature: 'x',
      }),
      'utf8',
    )
    result = loadSystemSnapshot()
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INTEGRITY_VIOLATION')
  })

  it('should reject payload with invalid generatedAt or health values', () => {
    writeFileSync(
      snapshotPath,
      JSON.stringify({
        version: 1,
        algorithm: 'HMAC-SHA256',
        payload: { generatedAt: Number.NaN, systemHealth: 'healthy' },
        signature: 'x',
      }),
      'utf8',
    )

    let result = loadSystemSnapshot()
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INTEGRITY_VIOLATION')

    writeFileSync(
      snapshotPath,
      JSON.stringify({
        version: 1,
        algorithm: 'HMAC-SHA256',
        payload: {
          generatedAt: Date.now(),
          systemHealth: 'unknown',
          agent: {},
          quarantine: {},
          quarantineMaxBytes: 1,
          watcher: {},
          houndPool: {},
          rateLimiter: {},
        },
        signature: 'x',
      }),
      'utf8',
    )

    result = loadSystemSnapshot()
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INTEGRITY_VIOLATION')
  })

  it('should reject signed payload when nested counters are structurally invalid', () => {
    const now = new Date('2026-03-05T10:00:00.000Z')
    vi.setSystemTime(now)
    const invalidPayload: unknown = {
      ...createFixtureSnapshot(now.getTime()),
      watcher: {
        ...createFixtureSnapshot(now.getTime()).watcher,
        threats: {
          total: 8,
          byCategory: { injection: 3, ddos: '2' },
          bySeverity: { critical: 1, high: 2, medium: 3, low: 2 },
        },
      },
      quarantine: {
        ...createFixtureSnapshot(now.getTime()).quarantine,
        bySeverity: { critical: 1, high: 1, medium: 1, low: '1' },
      },
    }
    const payloadText = JSON.stringify(invalidPayload)
    const signature = createHmac('sha256', SNAPSHOT_SECRET).update(payloadText).digest('hex')

    writeFileSync(
      snapshotPath,
      JSON.stringify({
        version: 1,
        algorithm: 'HMAC-SHA256',
        payload: invalidPayload,
        signature,
      }),
      'utf8',
    )

    const result = loadSystemSnapshot()
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('INTEGRITY_VIOLATION')
  })
})
