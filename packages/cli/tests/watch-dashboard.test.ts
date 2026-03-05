import { createHmac } from 'node:crypto'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { recordTraceInspectionEntry, type SystemSnapshot } from '@tracehound/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderDashboard, watchCommand } from '../src/commands/watch.js'

const SNAPSHOT_SECRET = 'tracehound-cli-watch-dashboard-secret'

function createFixtureSnapshot(): SystemSnapshot {
  const now = Date.now()
  return {
    generatedAt: now,
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
      snapshotTime: now,
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

describe('watch dashboard rendering', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let setIntervalSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>
  let onSpy: ReturnType<typeof vi.spyOn>
  let previousSnapshotPath: string | undefined
  let previousSnapshotSecret: string | undefined
  let previousRegistryPath: string | undefined
  let fixtureDir = ''
  let sigintHandler: (() => void) | null = null

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'tracehound-watch-dashboard-'))
    previousSnapshotPath = process.env.TRACEHOUND_SYSTEM_SNAPSHOT_PATH
    previousSnapshotSecret = process.env.TRACEHOUND_SNAPSHOT_SECRET
    previousRegistryPath = process.env.TRACEHOUND_TRACE_REGISTRY_PATH

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 0 as unknown as NodeJS.Timeout)
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    onSpy = vi.spyOn(process, 'on').mockImplementation(((event: string, listener: (...args: unknown[]) => void) => {
      if (event === 'SIGINT') {
        sigintHandler = () => listener()
      }
      return process
    }) as typeof process.on)
  })

  afterEach(() => {
    logSpy.mockRestore()
    setIntervalSpy.mockRestore()
    exitSpy.mockRestore()
    onSpy.mockRestore()
    sigintHandler = null
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
    if (previousRegistryPath === undefined) {
      delete process.env.TRACEHOUND_TRACE_REGISTRY_PATH
    } else {
      process.env.TRACEHOUND_TRACE_REGISTRY_PATH = previousRegistryPath
    }
  })

  it('should render disconnected dashboard when snapshot is unavailable', () => {
    process.env.TRACEHOUND_SYSTEM_SNAPSHOT_PATH = join(fixtureDir, 'missing-snapshot.json')
    process.env.TRACEHOUND_SNAPSHOT_SECRET = SNAPSHOT_SECRET

    watchCommand.exitOverride()
    watchCommand.parse(['watch', '--refresh', '250'], { from: 'user' })

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('Runtime snapshot unavailable')
    expect(output).toContain('NO_INSTANCE')
  })

  it('should render connected dashboard and handle SIGINT teardown', () => {
    const snapshotPath = join(fixtureDir, 'system-snapshot.json')
    const registryPath = join(fixtureDir, 'trace-registry.ndjson')
    process.env.TRACEHOUND_SYSTEM_SNAPSHOT_PATH = snapshotPath
    process.env.TRACEHOUND_SNAPSHOT_SECRET = SNAPSHOT_SECRET
    process.env.TRACEHOUND_TRACE_REGISTRY_PATH = registryPath

    writeFixtureSnapshotToDisk(createFixtureSnapshot(), snapshotPath, SNAPSHOT_SECRET)
    recordTraceInspectionEntry({
      traceId: 'trace-watch-01',
      signature: 'injection:watch-signature',
      severity: 'critical',
      size: 2048,
      captured: Date.now(),
      source: '127.0.0.1',
    })

    watchCommand.exitOverride()
    watchCommand.parse(['watch', '--refresh', '250'], { from: 'user' })

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('TRACEHOUND LIVE DASHBOARD')
    expect(output).toContain('RECENT THREATS')
    expect(output).toContain('injection:wa...')
    expect(setIntervalSpy).toHaveBeenCalled()

    expect(sigintHandler).not.toBeNull()
    sigintHandler?.()
    expect(exitSpy).toHaveBeenCalledWith(0)

    const outputAfterSigint = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(outputAfterSigint).toContain('Dashboard closed')
  })

  it('should render explicit exhausted state with non-empty threat list', () => {
    renderDashboard(
      {
        timestamp: new Date().toISOString(),
        system: {
          version: 'test-version',
          uptime: '0h 10m 0s',
          health: 'critical',
        },
        quarantine: {
          count: 10,
          bytes: 8000,
          maxBytes: 10000,
          bySeverity: {
            critical: 4,
            high: 3,
            medium: 2,
            low: 1,
          },
        },
        houndPool: {
          active: 4,
          dormant: 0,
          total: 4,
          status: 'exhausted',
        },
        recentThreats: [
          {
            signature: 'injection:abcdef1234567890',
            severity: 'critical',
            category: 'injection',
            size: '2.0 KB',
            time: '10:00:00',
          },
        ],
      },
      250,
    )

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('EXHAUSTED')
    expect(output).toContain('RECENT THREATS')
    expect(output).toContain('injection:ab...')
  })
})
