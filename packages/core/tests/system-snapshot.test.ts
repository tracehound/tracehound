import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentStats } from '../src/core/agent.js'
import type { HoundPoolStats } from '../src/core/hound-pool.js'
import type { QuarantineStats } from '../src/core/quarantine.js'
import type { RateLimiterStats } from '../src/core/rate-limiter.js'
import type { ITracehound } from '../src/core/tracehound.js'
import type { WatcherSnapshot } from '../src/core/watcher.js'
import {
  exportSystemSnapshot,
  readSystemSnapshotFromDisk,
  resolveSystemSnapshotPath,
  resolveSystemSnapshotSecret,
  SYSTEM_SNAPSHOT_ENV,
  writeSystemSnapshotToDisk,
  type SystemSnapshot,
} from '../src/utils/system-snapshot.js'

function createAgentStats(): AgentStats {
  return {
    totalIntercepts: 10,
    cleanCount: 4,
    rateLimitedCount: 1,
    validationFailures: 0,
    ignoredCount: 2,
    quarantinedCount: 3,
    errorCount: 0,
    coordinationFallbackCount: 0,
    coordinationWarningCount: 0,
    membraneRejectionCount: 0,
  }
}

function createQuarantineStats(): QuarantineStats {
  return {
    count: 3,
    bytes: 1024,
    droppedCount: 0,
    droppedBytes: 0,
    evictedCount: 0,
    decayedCount: 0,
    archivedCount: 0,
    archiveFailureCount: 0,
    ttlEnabled: false,
    nextExpiryAt: null,
    bySeverity: { critical: 1, high: 1, medium: 1, low: 0 },
  }
}

function createRateLimiterStats(): RateLimiterStats {
  return {
    sources: 2,
    blocked: 0,
    totalChecks: 10,
    totalRejections: 1,
    totalEvictions: 0,
  }
}

function createWatcherSnapshot(
  partial: Partial<WatcherSnapshot> = {},
  now = Date.now(),
): WatcherSnapshot {
  const pressure = {
    mode: 'normal' as const,
    archiveSuppressed: false,
    updatedAt: now,
    signals: {
      quarantineBytes: 1024,
      quarantineCount: 3,
      quarantineCapacityPercent: 20,
      droppedEvents: 0,
      archiveFailureCount: 0,
      houndPressureEvents: 0,
      overloaded: false,
    },
  }

  return {
    uptimeMs: 5000,
    threats: {
      total: 3,
      byCategory: { injection: 2, ddos: 1 },
      bySeverity: { critical: 1, high: 1, medium: 1, low: 0 },
    },
    quarantine: {
      count: 3,
      bytes: 1024,
      capacityPercent: 20,
    },
    totalAlerts: 0,
    alertsInWindow: 0,
    lastAlert: null,
    overloaded: false,
    pressure,
    snapshotTime: now,
    ...partial,
  }
}

function createIsolationTelemetry() {
  return {
    constraints: {
      maxMemoryMB: 128,
      networkAccess: false,
      fileSystemWrite: false,
      childSpawn: false,
    },
    capabilities: {
      platform: 'linux',
      memoryLimit: 'enforced',
      processTermination: 'enforced',
      environmentIsolation: 'allowlist',
      networkAccess: 'declarative',
      fileSystemWrite: 'declarative',
      childSpawn: 'declarative',
    },
    environmentAllowlistSize: 10,
  } as const
}

function createHoundPoolStats(partial: Partial<HoundPoolStats> = {}): HoundPoolStats {
  return {
    activeProcesses: 0,
    totalProcesses: 4,
    totalActivations: 5,
    totalTimeouts: 0,
    totalErrors: 0,
    avgProcessingMs: 5,
    isolationTelemetry: createIsolationTelemetry(),
    ...partial,
  }
}

function createMockTracehound(watcher: WatcherSnapshot, pool: HoundPoolStats): ITracehound {
  const mock = {
    agent: { getStats: () => createAgentStats() },
    quarantine: { stats: createQuarantineStats(), maxBytes: 4096 },
    rateLimiter: { stats: createRateLimiterStats() },
    watcher: { snapshot: () => watcher },
    auditChain: {},
    notifications: {},
    houndPool: { stats: pool, shutdown: () => {} },
    snapshot: () => {
      throw new Error('not used in tests')
    },
    shutdown: () => {},
  }

  return mock as unknown as ITracehound
}

describe('system-snapshot utilities', () => {
  const previousPath = process.env[SYSTEM_SNAPSHOT_ENV.PATH]
  const previousSecret = process.env[SYSTEM_SNAPSHOT_ENV.SECRET]

  afterEach(() => {
    if (previousPath === undefined) {
      delete process.env[SYSTEM_SNAPSHOT_ENV.PATH]
    } else {
      process.env[SYSTEM_SNAPSHOT_ENV.PATH] = previousPath
    }
    if (previousSecret === undefined) {
      delete process.env[SYSTEM_SNAPSHOT_ENV.SECRET]
    } else {
      process.env[SYSTEM_SNAPSHOT_ENV.SECRET] = previousSecret
    }
    vi.restoreAllMocks()
  })

  it('should resolve snapshot path from override, env, and default', () => {
    const override = resolveSystemSnapshotPath('/tmp/custom.json')
    expect(override).toBe('/tmp/custom.json')

    process.env[SYSTEM_SNAPSHOT_ENV.PATH] = '/tmp/from-env.json'
    const fromEnv = resolveSystemSnapshotPath()
    expect(fromEnv).toBe('/tmp/from-env.json')

    delete process.env[SYSTEM_SNAPSHOT_ENV.PATH]
    const fallback = resolveSystemSnapshotPath()
    expect(fallback).toContain('tracehound')
    expect(fallback).toContain('system-snapshot.json')
  })

  it('should resolve snapshot secret from override, env, and null', () => {
    const override = resolveSystemSnapshotSecret('abc')
    expect(override).toBe('abc')

    process.env[SYSTEM_SNAPSHOT_ENV.SECRET] = 'env-secret'
    expect(resolveSystemSnapshotSecret()).toBe('env-secret')

    delete process.env[SYSTEM_SNAPSHOT_ENV.SECRET]
    expect(resolveSystemSnapshotSecret()).toBeNull()
  })

  it('should derive critical health when watcher is overloaded', () => {
    const watcher = createWatcherSnapshot({ overloaded: true })
    const pool = createHoundPoolStats()
    const snapshot = exportSystemSnapshot(createMockTracehound(watcher, pool))

    expect(snapshot.systemHealth).toBe('critical')
  })

  it('should derive critical health when pool is exhausted', () => {
    const watcher = createWatcherSnapshot({
      overloaded: false,
      alertsInWindow: 0,
    })
    const pool = createHoundPoolStats({
      activeProcesses: 4,
      totalProcesses: 4,
    })
    const snapshot = exportSystemSnapshot(createMockTracehound(watcher, pool))

    expect(snapshot.systemHealth).toBe('critical')
  })

  it('should derive pressure-driven health states from watcher pressure mode', () => {
    const elevated = exportSystemSnapshot(
      createMockTracehound(
        createWatcherSnapshot({
          pressure: {
            ...createWatcherSnapshot().pressure,
            mode: 'elevated',
          },
        }),
        createHoundPoolStats(),
      ),
    )
    const critical = exportSystemSnapshot(
      createMockTracehound(
        createWatcherSnapshot({
          pressure: {
            ...createWatcherSnapshot().pressure,
            mode: 'critical',
            archiveSuppressed: true,
          },
        }),
        createHoundPoolStats(),
      ),
    )

    expect(elevated.systemHealth).toBe('degraded')
    expect(critical.systemHealth).toBe('critical')
  })

  it('should keep pool exhaustion critical even when pressure mode is elevated', () => {
    const snapshot = exportSystemSnapshot(
      createMockTracehound(
        createWatcherSnapshot({
          overloaded: false,
          alertsInWindow: 0,
          pressure: {
            ...createWatcherSnapshot().pressure,
            mode: 'elevated',
          },
        }),
        createHoundPoolStats({
          activeProcesses: 4,
          totalProcesses: 4,
        }),
      ),
    )

    expect(snapshot.systemHealth).toBe('critical')
  })

  it('should derive degraded and healthy health states', () => {
    const degraded = exportSystemSnapshot(
      createMockTracehound(createWatcherSnapshot({ alertsInWindow: 2 }), createHoundPoolStats()),
    )
    const healthy = exportSystemSnapshot(
      createMockTracehound(createWatcherSnapshot({ alertsInWindow: 0 }), createHoundPoolStats()),
    )

    expect(degraded.systemHealth).toBe('degraded')
    expect(healthy.systemHealth).toBe('healthy')
  })

  it('should write and read signed snapshot round-trip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracehound-system-snapshot-'))
    const path = join(dir, 'snapshot.json')
    const snapshot = exportSystemSnapshot(
      createMockTracehound(createWatcherSnapshot(), createHoundPoolStats()),
    )

    writeSystemSnapshotToDisk(snapshot, path, 'secret')
    const result = readSystemSnapshotFromDisk(path, 'secret')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.systemHealth).toBe(snapshot.systemHealth)
    rmSync(dir, { recursive: true, force: true })
  })

  it('should accept decimal maxMemoryMB in isolation telemetry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracehound-system-snapshot-'))
    const path = join(dir, 'snapshot.json')
    const telemetry = createIsolationTelemetry()
    const snapshot = exportSystemSnapshot(
      createMockTracehound(
        createWatcherSnapshot(),
        createHoundPoolStats({
          isolationTelemetry: {
            ...telemetry,
            constraints: {
              ...telemetry.constraints,
              maxMemoryMB: 64.5,
            },
          },
        }),
      ),
    )

    writeSystemSnapshotToDisk(snapshot, path, 'secret')
    const result = readSystemSnapshotFromDisk(path, 'secret')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.houndPool.isolationTelemetry?.constraints.maxMemoryMB).toBe(64.5)

    rmSync(dir, { recursive: true, force: true })
  })

  it('should accept unknown platform and best_effort telemetry capabilities', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracehound-system-snapshot-'))
    const path = join(dir, 'snapshot.json')
    const telemetry = createIsolationTelemetry()
    const snapshot = exportSystemSnapshot(
      createMockTracehound(
        createWatcherSnapshot(),
        createHoundPoolStats({
          isolationTelemetry: {
            ...telemetry,
            capabilities: {
              ...telemetry.capabilities,
              platform: 'unknown',
              memoryLimit: 'best_effort',
              processTermination: 'best_effort',
              networkAccess: 'best_effort',
              fileSystemWrite: 'best_effort',
              childSpawn: 'best_effort',
            },
          },
        }),
      ),
    )

    writeSystemSnapshotToDisk(snapshot, path, 'secret')
    const result = readSystemSnapshotFromDisk(path, 'secret')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.houndPool.isolationTelemetry?.capabilities.platform).toBe('unknown')
    expect(result.snapshot.houndPool.isolationTelemetry?.capabilities.memoryLimit).toBe(
      'best_effort',
    )

    rmSync(dir, { recursive: true, force: true })
  })

  it('should accept legacy hound pool stats without isolation telemetry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracehound-system-snapshot-'))
    const path = join(dir, 'snapshot.json')
    const snapshot = exportSystemSnapshot(
      createMockTracehound(createWatcherSnapshot(), createHoundPoolStats({})),
    )

    writeSystemSnapshotToDisk(snapshot, path, 'secret')
    const result = readSystemSnapshotFromDisk(path, 'secret')
    expect(result.ok).toBe(true)

    rmSync(dir, { recursive: true, force: true })
  })

  it('should return NO_INSTANCE when file does not exist', () => {
    const path = join(tmpdir(), 'tracehound-missing', 'snapshot.json')
    const result = readSystemSnapshotFromDisk(path, 'secret')
    expect(result).toEqual({ ok: false, reason: 'NO_INSTANCE' })
  })

  it('should return INTEGRITY_VIOLATION when secret is empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracehound-system-snapshot-'))
    const path = join(dir, 'snapshot.json')
    const snapshot = exportSystemSnapshot(
      createMockTracehound(createWatcherSnapshot(), createHoundPoolStats()),
    )
    writeSystemSnapshotToDisk(snapshot, path, 'secret')

    const result = readSystemSnapshotFromDisk(path, '')
    expect(result).toEqual({ ok: false, reason: 'INTEGRITY_VIOLATION' })
    rmSync(dir, { recursive: true, force: true })
  })

  it('should return INVALID_FORMAT for malformed and structurally invalid payloads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracehound-system-snapshot-'))
    const malformedPath = join(dir, 'malformed.json')
    writeFileSync(malformedPath, '{', 'utf8')
    expect(readSystemSnapshotFromDisk(malformedPath, 'secret')).toEqual({
      ok: false,
      reason: 'INVALID_FORMAT',
    })

    const invalidStructPath = join(dir, 'invalid-struct.json')
    writeFileSync(
      invalidStructPath,
      JSON.stringify({
        version: 1,
        algorithm: 'HMAC-SHA256',
        payload: {},
        signature: 'x',
      }),
      'utf8',
    )
    expect(readSystemSnapshotFromDisk(invalidStructPath, 'secret')).toEqual({
      ok: false,
      reason: 'INVALID_FORMAT',
    })

    rmSync(dir, { recursive: true, force: true })
  })

  it('should read legacy signed snapshots when pressure fields are absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracehound-system-snapshot-'))
    const path = join(dir, 'legacy-snapshot.json')
    const generatedAt = Date.now()
    const legacyPayload = {
      generatedAt,
      systemHealth: 'degraded' as const,
      agent: createAgentStats(),
      quarantine: createQuarantineStats(),
      quarantineMaxBytes: 4096,
      watcher: {
        uptimeMs: 5000,
        threats: {
          total: 3,
          byCategory: { injection: 2, ddos: 1 },
          bySeverity: { critical: 1, high: 1, medium: 1, low: 0 },
        },
        quarantine: {
          count: 3,
          bytes: 1024,
          capacityPercent: 20,
        },
        totalAlerts: 0,
        alertsInWindow: 0,
        lastAlert: null,
        overloaded: false,
        snapshotTime: generatedAt,
      },
      houndPool: createHoundPoolStats(),
      rateLimiter: createRateLimiterStats(),
    }
    const payloadText = JSON.stringify(legacyPayload)
    const signature = createHmac('sha256', 'secret').update(payloadText).digest('hex')

    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        algorithm: 'HMAC-SHA256',
        payload: legacyPayload,
        signature,
      }),
      'utf8',
    )

    const result = readSystemSnapshotFromDisk(path, 'secret')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.pressure.mode).toBe('normal')
    expect(result.snapshot.pressure.archiveSuppressed).toBe(false)
    expect(result.snapshot.watcher.pressure.mode).toBe('normal')

    rmSync(dir, { recursive: true, force: true })
  })

  it('should reject signed envelope with invalid metadata variants', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracehound-system-snapshot-'))
    const path = join(dir, 'invalid-signed.json')
    const invalidCases = [
      { version: 2, algorithm: 'HMAC-SHA256', payload: {}, signature: 'x' },
      { version: 1, algorithm: 'HMAC-MD5', payload: {}, signature: 'x' },
      { version: 1, algorithm: 'HMAC-SHA256', payload: {}, signature: '' },
      {
        version: 1,
        algorithm: 'HMAC-SHA256',
        payload: { generatedAt: Number.NaN, systemHealth: 'healthy' },
        signature: 'x',
      },
      {
        version: 1,
        algorithm: 'HMAC-SHA256',
        payload: {
          generatedAt: Date.now(),
          systemHealth: 'unknown',
          quarantineMaxBytes: 1,
          agent: {},
          quarantine: {},
          watcher: {},
          houndPool: {},
          rateLimiter: {},
        },
        signature: 'x',
      },
      {
        version: 1,
        algorithm: 'HMAC-SHA256',
        payload: {
          generatedAt: Date.now(),
          systemHealth: 'healthy',
          quarantineMaxBytes: 1024,
          agent: createAgentStats(),
          quarantine: {
            ...createQuarantineStats(),
            bySeverity: { critical: 1, high: '1', medium: 1, low: 0 },
          },
          watcher: {
            ...createWatcherSnapshot(),
            threats: {
              total: 3,
              byCategory: { injection: '2' },
              bySeverity: { critical: 1, high: 1, medium: 1, low: 0 },
            },
          },
          houndPool: createHoundPoolStats(),
          rateLimiter: createRateLimiterStats(),
        },
        signature: 'x',
      },
      {
        version: 1,
        algorithm: 'HMAC-SHA256',
        payload: {
          generatedAt: Date.now(),
          systemHealth: 'healthy',
          quarantineMaxBytes: 1024,
          agent: createAgentStats(),
          quarantine: createQuarantineStats(),
          watcher: createWatcherSnapshot(),
          houndPool: null,
          rateLimiter: createRateLimiterStats(),
        },
        signature: 'x',
      },
      {
        version: 1,
        algorithm: 'HMAC-SHA256',
        payload: {
          generatedAt: Date.now(),
          systemHealth: 'healthy',
          quarantineMaxBytes: 1024,
          agent: createAgentStats(),
          quarantine: createQuarantineStats(),
          watcher: createWatcherSnapshot(),
          houndPool: {
            ...createHoundPoolStats(),
            isolationTelemetry: null,
          },
          rateLimiter: createRateLimiterStats(),
        },
        signature: 'x',
      },
      {
        version: 1,
        algorithm: 'HMAC-SHA256',
        payload: {
          generatedAt: Date.now(),
          systemHealth: 'healthy',
          quarantineMaxBytes: 1024,
          agent: createAgentStats(),
          quarantine: createQuarantineStats(),
          watcher: createWatcherSnapshot(),
          houndPool: {
            ...createHoundPoolStats(),
            isolationTelemetry: {
              ...createIsolationTelemetry(),
              constraints: null,
            },
          },
          rateLimiter: createRateLimiterStats(),
        },
        signature: 'x',
      },
      {
        version: 1,
        algorithm: 'HMAC-SHA256',
        payload: {
          generatedAt: Date.now(),
          systemHealth: 'healthy',
          quarantineMaxBytes: 1024,
          agent: createAgentStats(),
          quarantine: createQuarantineStats(),
          watcher: createWatcherSnapshot(),
          houndPool: {
            ...createHoundPoolStats(),
            isolationTelemetry: {
              ...createIsolationTelemetry(),
              capabilities: null,
            },
          },
          rateLimiter: createRateLimiterStats(),
        },
        signature: 'x',
      },
      {
        version: 1,
        algorithm: 'HMAC-SHA256',
        payload: {
          generatedAt: Date.now(),
          systemHealth: 'healthy',
          quarantineMaxBytes: 1024,
          agent: createAgentStats(),
          quarantine: {
            ...createQuarantineStats(),
            bySeverity: null,
          },
          watcher: createWatcherSnapshot(),
          pressure: {
            mode: 'elevated',
            archiveSuppressed: false,
            updatedAt: Date.now(),
            signals: {
              quarantineBytes: 1024,
              quarantineCount: 3,
              quarantineCapacityPercent: '50',
              droppedEvents: 0,
              archiveFailureCount: 0,
              houndPressureEvents: 0,
              overloaded: false,
            },
          },
          houndPool: createHoundPoolStats(),
          rateLimiter: createRateLimiterStats(),
        },
        signature: 'x',
      },
      {
        version: 1,
        algorithm: 'HMAC-SHA256',
        payload: {
          generatedAt: Date.now(),
          systemHealth: 'healthy',
          quarantineMaxBytes: 1024,
          agent: createAgentStats(),
          quarantine: createQuarantineStats(),
          watcher: {
            ...createWatcherSnapshot(),
            threats: {
              total: 3,
              byCategory: null,
              bySeverity: { critical: 1, high: 1, medium: 1, low: 0 },
            },
          },
          houndPool: createHoundPoolStats(),
          rateLimiter: createRateLimiterStats(),
        },
        signature: 'x',
      },
      {
        version: 1,
        algorithm: 'HMAC-SHA256',
        payload: {
          generatedAt: Date.now(),
          systemHealth: 'healthy',
          quarantineMaxBytes: 1024,
          agent: createAgentStats(),
          quarantine: createQuarantineStats(),
          watcher: {
            ...createWatcherSnapshot(),
            threats: {
              total: 3,
              byCategory: { injection: '2' },
              bySeverity: { critical: 1, high: 1, medium: 1, low: 0 },
            },
          },
          houndPool: createHoundPoolStats(),
          rateLimiter: createRateLimiterStats(),
        },
        signature: 'x',
      },
      {
        version: 1,
        algorithm: 'HMAC-SHA256',
        payload: {
          generatedAt: Date.now(),
          systemHealth: 'healthy',
          quarantineMaxBytes: 1024,
          agent: createAgentStats(),
          quarantine: createQuarantineStats(),
          watcher: createWatcherSnapshot(),
          houndPool: createHoundPoolStats(),
          rateLimiter: null,
        },
        signature: 'x',
      },
      {
        version: 1,
        algorithm: 'HMAC-SHA256',
        payload: {
          generatedAt: Date.now(),
          systemHealth: 'healthy',
          quarantineMaxBytes: 1024,
          agent: createAgentStats(),
          quarantine: createQuarantineStats(),
          watcher: createWatcherSnapshot(),
          houndPool: {
            ...createHoundPoolStats(),
            isolationTelemetry: {
              ...createIsolationTelemetry(),
              environmentAllowlistSize: -1,
            },
          },
          rateLimiter: createRateLimiterStats(),
        },
        signature: 'x',
      },
      {
        version: 1,
        algorithm: 'HMAC-SHA256',
        payload: {
          generatedAt: Date.now(),
          systemHealth: 'healthy',
          quarantineMaxBytes: 1024,
          agent: createAgentStats(),
          quarantine: createQuarantineStats(),
          watcher: createWatcherSnapshot({
            lastAlert: {
              id: 'alert-invalid-type',
              type: 'invalid-type' as 'threat_detected',
              severity: 'warning',
              message: 'bad alert type',
              timestamp: Date.now(),
            },
          }),
          houndPool: createHoundPoolStats(),
          rateLimiter: createRateLimiterStats(),
        },
        signature: 'x',
      },
      {
        version: 1,
        algorithm: 'HMAC-SHA256',
        payload: {
          generatedAt: Date.now(),
          systemHealth: 'healthy',
          quarantineMaxBytes: 1024,
          agent: createAgentStats(),
          quarantine: createQuarantineStats(),
          watcher: createWatcherSnapshot({
            lastAlert: {
              id: 'alert-invalid-severity',
              type: 'threat_detected',
              severity: 'fatal' as 'warning',
              message: 'bad severity',
              timestamp: Number.NaN,
            },
          }),
          houndPool: createHoundPoolStats(),
          rateLimiter: createRateLimiterStats(),
        },
        signature: 'x',
      },
      {
        version: 1,
        algorithm: 'HMAC-SHA256',
        payload: {
          generatedAt: Date.now(),
          systemHealth: 'healthy',
          quarantineMaxBytes: 1024,
          agent: createAgentStats(),
          quarantine: createQuarantineStats(),
          watcher: createWatcherSnapshot({
            lastAlert: {
              id: 'alert-invalid-context',
              type: 'threat_detected',
              severity: 'warning',
              message: 'bad context',
              timestamp: Date.now(),
              context: 'not-an-object' as unknown as Record<string, unknown>,
            },
          }),
          houndPool: createHoundPoolStats(),
          rateLimiter: createRateLimiterStats(),
        },
        signature: 'x',
      },
    ]

    try {
      for (const invalid of invalidCases) {
        writeFileSync(path, JSON.stringify(invalid), 'utf8')
        expect(readSystemSnapshotFromDisk(path, 'secret')).toEqual({
          ok: false,
          reason: 'INVALID_FORMAT',
        })
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('should return INTEGRITY_VIOLATION when signature is mismatched', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracehound-system-snapshot-'))
    const path = join(dir, 'snapshot.json')
    const snapshot = exportSystemSnapshot(
      createMockTracehound(createWatcherSnapshot(), createHoundPoolStats()),
    )
    writeSystemSnapshotToDisk(snapshot, path, 'secret-a')
    const result = readSystemSnapshotFromDisk(path, 'secret-b')

    expect(result).toEqual({ ok: false, reason: 'INTEGRITY_VIOLATION' })
    rmSync(dir, { recursive: true, force: true })
  })

  it('should return IO_ERROR when target is a directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracehound-system-snapshot-dir-'))
    const result = readSystemSnapshotFromDisk(dir, 'secret')

    expect(result).toEqual({ ok: false, reason: 'IO_ERROR' })
    rmSync(dir, { recursive: true, force: true })
  })

  it('should throw typed error when write secret is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracehound-system-snapshot-'))
    const path = join(dir, 'snapshot.json')
    const snapshot = exportSystemSnapshot(
      createMockTracehound(createWatcherSnapshot(), createHoundPoolStats()),
    )

    expect(() => writeSystemSnapshotToDisk(snapshot, path, '')).toThrow()
    rmSync(dir, { recursive: true, force: true })
  })

  it('should wrap filesystem write errors as snapshot write failure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracehound-system-snapshot-'))
    const parentFile = join(dir, 'not-a-directory')
    writeFileSync(parentFile, 'x', 'utf8')

    const path = join(parentFile, 'snapshot.json')
    const snapshot = exportSystemSnapshot(
      createMockTracehound(createWatcherSnapshot(), createHoundPoolStats()),
    )

    try {
      writeSystemSnapshotToDisk(snapshot, path, 'secret')
      expect.fail('writeSystemSnapshotToDisk should throw')
    } catch (error: unknown) {
      const typed = error as { code?: string }
      expect(typed.code).toBe('RUNTIME_SNAPSHOT_WRITE_FAILED')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('should replace existing snapshot on repeated writes and emit at most one Windows ACL warning', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracehound-system-snapshot-'))
    const path = join(dir, 'snapshot.json')
    const warningSpy = vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
    const snapshotA = exportSystemSnapshot(
      createMockTracehound(createWatcherSnapshot(), createHoundPoolStats()),
    )
    const snapshotB: SystemSnapshot = {
      ...snapshotA,
      generatedAt: snapshotA.generatedAt + 1,
    }

    writeSystemSnapshotToDisk(snapshotA, path, 'secret')
    writeSystemSnapshotToDisk(snapshotB, path, 'secret')
    const loaded = readSystemSnapshotFromDisk(path, 'secret')
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.snapshot.generatedAt).toBe(snapshotB.generatedAt)

    if (process.platform === 'win32') {
      expect(warningSpy.mock.calls.length).toBeLessThanOrEqual(1)
    } else {
      expect(warningSpy).not.toHaveBeenCalled()
    }

    rmSync(dir, { recursive: true, force: true })
  })

  it('should execute non-win32 hardening path without warning', () => {
    if (process.platform === 'win32') {
      return
    }

    const dir = mkdtempSync(join(tmpdir(), 'tracehound-system-snapshot-'))
    const path = join(dir, 'snapshot.json')
    const snapshot = exportSystemSnapshot(
      createMockTracehound(createWatcherSnapshot(), createHoundPoolStats()),
    )
    const warningSpy = vi.spyOn(process, 'emitWarning').mockImplementation(() => {})

    try {
      expect(() => writeSystemSnapshotToDisk(snapshot, path, 'secret')).not.toThrow()
      expect(warningSpy).not.toHaveBeenCalled()
    } finally {
      warningSpy.mockRestore()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('should produce signed envelope with expected metadata', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracehound-system-snapshot-'))
    const path = join(dir, 'snapshot.json')
    const snapshot = exportSystemSnapshot(
      createMockTracehound(createWatcherSnapshot(), createHoundPoolStats()),
    )
    writeSystemSnapshotToDisk(snapshot, path, 'secret')

    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      version: number
      algorithm: string
      signature: string
      payload: unknown
    }

    expect(raw.version).toBe(1)
    expect(raw.algorithm).toBe('HMAC-SHA256')
    expect(typeof raw.signature).toBe('string')
    expect(raw.signature.length).toBeGreaterThan(0)
    expect(typeof raw.payload).toBe('object')

    rmSync(dir, { recursive: true, force: true })
  })
})
