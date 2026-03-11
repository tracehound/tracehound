import {
  recordTraceInspectionEntry,
  SYSTEM_SNAPSHOT_ENV,
  type SystemSnapshot,
} from '@tracehound/core'
import { createHmac } from 'node:crypto'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  renderAgent,
  renderDashboard,
  renderHelp,
  renderPool,
  renderQuarantine,
  renderScreen,
  renderWatcher,
  watchCommand,
} from '../src/commands/watch.js'

const SNAPSHOT_SECRET = 'tracehound-cli-watch-dashboard-secret'

function createFixtureSnapshot(partial?: Partial<SystemSnapshot['houndPool']>): SystemSnapshot {
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
      evictedCount: 0,
      decayedCount: 0,
      archivedCount: 0,
      archiveFailureCount: 0,
      ttlEnabled: false,
      nextExpiryAt: null,
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
      ...partial,
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
    previousSnapshotPath = process.env[SYSTEM_SNAPSHOT_ENV.PATH]
    previousSnapshotSecret = process.env[SYSTEM_SNAPSHOT_ENV.SECRET]
    previousRegistryPath = process.env.TRACEHOUND_TRACE_REGISTRY_PATH

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    setIntervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockImplementation(() => 0 as unknown as NodeJS.Timeout) as ReturnType<typeof vi.spyOn>
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never) as ReturnType<
      typeof vi.spyOn
    >
    onSpy = vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      listener: (...args: unknown[]) => void,
    ) => {
      if (event === 'SIGINT') {
        sigintHandler = () => listener()
      }
      return process
    }) as typeof process.on) as ReturnType<typeof vi.spyOn>
  })

  afterEach(() => {
    logSpy.mockRestore()
    setIntervalSpy.mockRestore()
    exitSpy.mockRestore()
    onSpy.mockRestore()
    sigintHandler = null
    rmSync(fixtureDir, { recursive: true, force: true })

    if (previousSnapshotPath === undefined) {
      delete process.env[SYSTEM_SNAPSHOT_ENV.PATH]
    } else {
      process.env[SYSTEM_SNAPSHOT_ENV.PATH] = previousSnapshotPath
    }
    if (previousSnapshotSecret === undefined) {
      delete process.env[SYSTEM_SNAPSHOT_ENV.SECRET]
    } else {
      process.env[SYSTEM_SNAPSHOT_ENV.SECRET] = previousSnapshotSecret
    }
    if (previousRegistryPath === undefined) {
      delete process.env.TRACEHOUND_TRACE_REGISTRY_PATH
    } else {
      process.env.TRACEHOUND_TRACE_REGISTRY_PATH = previousRegistryPath
    }
  })

  it('should render disconnected dashboard when snapshot is unavailable', () => {
    process.env[SYSTEM_SNAPSHOT_ENV.PATH] = join(fixtureDir, 'missing-snapshot.json')
    process.env[SYSTEM_SNAPSHOT_ENV.SECRET] = SNAPSHOT_SECRET

    watchCommand.exitOverride()
    watchCommand.parse(['watch', '--refresh', '250'], { from: 'user' })

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('Runtime snapshot unavailable')
    expect(output).toContain('NO_INSTANCE')
  })

  it('should render connected dashboard and handle SIGINT teardown', () => {
    const snapshotPath = join(fixtureDir, 'system-snapshot.json')
    const registryPath = join(fixtureDir, 'trace-registry.ndjson')
    process.env[SYSTEM_SNAPSHOT_ENV.PATH] = snapshotPath
    process.env[SYSTEM_SNAPSHOT_ENV.SECRET] = SNAPSHOT_SECRET
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
    expect(output).toContain('Tracehound Watcher')
    expect(output).toContain('WATCHER')
    expect(output).toContain('injection:watch-si...')
    expect(setIntervalSpy).toHaveBeenCalled()

    expect(sigintHandler).not.toBeNull()
    sigintHandler?.()
    expect(exitSpy).toHaveBeenCalledWith(0)

    const outputAfterSigint = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(outputAfterSigint).toContain('Dashboard closed')
  })

  it('should render unknown category when signature has no delimiter', () => {
    const snapshotPath = join(fixtureDir, 'system-snapshot.json')
    const registryPath = join(fixtureDir, 'trace-registry.ndjson')
    process.env[SYSTEM_SNAPSHOT_ENV.PATH] = snapshotPath
    process.env[SYSTEM_SNAPSHOT_ENV.SECRET] = SNAPSHOT_SECRET
    process.env.TRACEHOUND_TRACE_REGISTRY_PATH = registryPath

    writeFixtureSnapshotToDisk(createFixtureSnapshot(), snapshotPath, SNAPSHOT_SECRET)
    recordTraceInspectionEntry({
      traceId: 'trace-watch-unknown-01',
      signature: 'signature-without-delimiter',
      severity: 'high',
      size: 1024,
      captured: Date.now(),
      source: '127.0.0.1',
    })

    watchCommand.exitOverride()
    watchCommand.parse(['watch', '--refresh', '250'], { from: 'user' })

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('unknown')
  })

  it('should render last alert type from live snapshot when lastAlert is set', () => {
    const snapshotPath = join(fixtureDir, 'system-snapshot.json')
    process.env[SYSTEM_SNAPSHOT_ENV.PATH] = snapshotPath
    process.env[SYSTEM_SNAPSHOT_ENV.SECRET] = SNAPSHOT_SECRET

    const now = Date.now()
    const snapshotWithAlert: SystemSnapshot = {
      ...createFixtureSnapshot(),
      watcher: {
        uptimeMs: 65_000,
        threats: {
          total: 3,
          byCategory: { injection: 3 },
          bySeverity: { critical: 1, high: 1, medium: 1, low: 0 },
        },
        totalAlerts: 1,
        alertsInWindow: 1,
        lastAlert: {
          id: 'alert-test-01',
          type: 'quarantine_high',
          severity: 'warning',
          message: 'Quarantine high watermark reached',
          timestamp: now,
        } as unknown as SystemSnapshot['watcher']['lastAlert'],
        overloaded: false,
        snapshotTime: now,
        quarantine: { count: 4, bytes: 4096, capacityPercent: 50 },
      },
    }
    writeFixtureSnapshotToDisk(snapshotWithAlert, snapshotPath, SNAPSHOT_SECRET)

    watchCommand.exitOverride()
    watchCommand.parse(['watch', '--refresh', '250'], { from: 'user' })

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('quarantine_high')
  })

  it('should render exhausted pool status from live snapshot mapping', () => {
    const snapshotPath = join(fixtureDir, 'system-snapshot.json')
    process.env[SYSTEM_SNAPSHOT_ENV.PATH] = snapshotPath
    process.env[SYSTEM_SNAPSHOT_ENV.SECRET] = SNAPSHOT_SECRET

    writeFixtureSnapshotToDisk(
      createFixtureSnapshot({ activeProcesses: 2, totalProcesses: 2 }),
      snapshotPath,
      SNAPSHOT_SECRET,
    )

    watchCommand.exitOverride()
    watchCommand.parse(['watch', '--refresh', '250'], { from: 'user' })

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain('EXHAUSTED')
  })

  it('should render explicit exhausted state with non-empty threat list', () => {
    renderDashboard(
      {
        timestamp: new Date().toISOString(),
        agent: {
          total: 10,
          clean: 5,
          quarantined: 3,
          rateLimited: 1,
          ignored: 0,
          validationFailures: 0,
          membraneRejections: 0,
          errors: 1,
        },
        system: {
          version: 'test-version',
          uptime: '10m',
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
          archiveFailures: 0,
          dropped: 0,
          nextExpiryAt: null,
        },
        houndPool: {
          active: 4,
          dormant: 0,
          total: 4,
          totalActivations: 20,
          avgProcessingMs: 35,
          totalTimeouts: 0,
          totalErrors: 0,
          status: 'exhausted',
        },
        rateLimiter: {
          sources: 2,
          blocked: 1,
          totalRejections: 1,
          totalEvictions: 0,
        },
        watcher: {
          threatTotal: 5,
          byCategory: { injection: 3, xss: 2 },
          lastAlert: null,
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
    expect(output).toContain('injection:abcdef12...')
  })
})

// ── Shared fixture ────────────────────────────────────────────────────────

function makeSnapshot(
  overrides: Partial<Parameters<typeof renderWatcher>[0]> = {},
): Parameters<typeof renderWatcher>[0] {
  return {
    timestamp: new Date().toISOString(),
    agent: {
      total: 100,
      clean: 80,
      quarantined: 10,
      rateLimited: 5,
      ignored: 3,
      validationFailures: 1,
      membraneRejections: 0,
      errors: 0,
    },
    system: { version: '1.0.0', uptime: '5m', health: 'healthy' },
    quarantine: {
      count: 10,
      bytes: 4096,
      maxBytes: 8192,
      bySeverity: { critical: 2, high: 3, medium: 3, low: 2 },
      archiveFailures: 0,
      dropped: 0,
      nextExpiryAt: null,
    },
    houndPool: {
      active: 1,
      dormant: 1,
      total: 2,
      totalActivations: 20,
      avgProcessingMs: 15.0,
      totalTimeouts: 0,
      totalErrors: 0,
      status: 'ok',
    },
    rateLimiter: { sources: 5, blocked: 0, totalRejections: 0, totalEvictions: 0 },
    watcher: {
      threatTotal: 5,
      byCategory: { injection: 3, ddos: 2 },
      lastAlert: { type: 'rate_limited', time: '10:00:00' },
    },
    recentThreats: [
      {
        signature: 'injection:abc1234567890123456',
        severity: 'high',
        category: 'injection',
        size: '1.0 KB',
        time: '10:00:01',
      },
    ],
    ...overrides,
  }
}

// ── renderWatcher ─────────────────────────────────────────────────────────

describe('renderWatcher', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    logSpy.mockRestore()
  })

  it('should render category summary and recent alerts when threats exist', () => {
    renderWatcher(makeSnapshot(), 120)
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('CATEGORY SUMMARY')
    expect(out).toContain('RECENT ALERTS')
    expect(out).toContain('LAST ALERT DETAIL')
    expect(out).toContain('injection')
  })

  it('should render no-data messages when no threats exist', () => {
    renderWatcher(
      makeSnapshot({
        watcher: { threatTotal: 0, byCategory: {}, lastAlert: null },
        recentThreats: [],
      }),
      120,
    )
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('no threat categories recorded')
    expect(out).toContain('no recent alerts')
  })

  it('should render compact mode with fewer alert rows', () => {
    const snapshot = makeSnapshot({
      recentThreats: [
        {
          signature: 'ddos:aaa111',
          severity: 'critical',
          category: 'ddos',
          size: '512 B',
          time: '10:00:01',
        },
        {
          signature: 'ddos:bbb222',
          severity: 'high',
          category: 'ddos',
          size: '512 B',
          time: '10:00:02',
        },
        {
          signature: 'ddos:ccc333',
          severity: 'medium',
          category: 'ddos',
          size: '512 B',
          time: '10:00:03',
        },
        {
          signature: 'ddos:ddd444',
          severity: 'low',
          category: 'ddos',
          size: '512 B',
          time: '10:00:04',
        },
      ],
    })
    renderWatcher(snapshot, 80) // compact
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('ddos')
  })
})

// ── renderQuarantine ──────────────────────────────────────────────────────

describe('renderQuarantine', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    logSpy.mockRestore()
  })

  it('should render storage, severity split and retention sections', () => {
    renderQuarantine(makeSnapshot(), 120)
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('STORAGE')
    expect(out).toContain('SPLIT BY SEVERITY')
    expect(out).toContain('RETENTION')
  })

  it('should show DEGRADED archive status when archive failures exist', () => {
    renderQuarantine(
      makeSnapshot({
        quarantine: {
          count: 5,
          bytes: 1024,
          maxBytes: 8192,
          bySeverity: { critical: 1, high: 1, medium: 1, low: 1 },
          archiveFailures: 2,
          dropped: 0,
          nextExpiryAt: null,
        },
      }),
      120,
    )
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('DEGRADED')
  })

  it('should render next expiry when nextExpiryAt is set', () => {
    renderQuarantine(
      makeSnapshot({
        quarantine: {
          count: 5,
          bytes: 1024,
          maxBytes: 8192,
          bySeverity: { critical: 1, high: 1, medium: 1, low: 1 },
          archiveFailures: 0,
          dropped: 0,
          nextExpiryAt: Date.now() + 60_000,
        },
      }),
      120,
    )
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('m') // some duration like "1m"
  })
})

// ── renderPool ────────────────────────────────────────────────────────────

describe('renderPool', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    logSpy.mockRestore()
  })

  it('should render pool state and timing sections', () => {
    renderPool(makeSnapshot(), 120)
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('POOL STATE')
    expect(out).toContain('TIMING')
    expect(out).toContain('STABLE')
  })

  it('should show EXHAUSTED when pool status is exhausted', () => {
    renderPool(
      makeSnapshot({
        houndPool: {
          active: 2,
          dormant: 0,
          total: 2,
          totalActivations: 5,
          avgProcessingMs: 10,
          totalTimeouts: 1,
          totalErrors: 0,
          status: 'exhausted',
        },
      }),
      120,
    )
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('EXHAUSTED')
  })
})

// ── renderAgent ───────────────────────────────────────────────────────────

describe('renderAgent', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    logSpy.mockRestore()
  })

  it('should render flow and rejections sections', () => {
    renderAgent(makeSnapshot(), 120)
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('FLOW')
    expect(out).toContain('REJECTIONS')
  })

  it('should render LAST ERROR section when agent errors exist', () => {
    renderAgent(
      makeSnapshot({
        agent: {
          total: 10,
          clean: 8,
          quarantined: 1,
          rateLimited: 0,
          ignored: 0,
          validationFailures: 0,
          membraneRejections: 0,
          errors: 3,
        },
      }),
      120,
    )
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('LAST ERROR')
    expect(out).toContain('3 error(s)')
  })
})

// ── renderHelp ────────────────────────────────────────────────────────────

describe('renderHelp', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    logSpy.mockRestore()
  })

  it('should render navigation, labels and status sections', () => {
    renderHelp(120)
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('NAVIGATION')
    expect(out).toContain('LABELS')
    expect(out).toContain('STATUS')
    expect(out).toContain('Overview')
    expect(out).toContain('injection')
  })
})

// ── renderScreen ──────────────────────────────────────────────────────────

describe('renderScreen', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    logSpy.mockRestore()
  })

  it('should dispatch to renderWatcher for watcher screen', () => {
    renderScreen('watcher', makeSnapshot(), 120, 1)
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('Watcher')
    expect(out).toContain('CATEGORY SUMMARY')
  })

  it('should dispatch to renderQuarantine for quarantine screen', () => {
    renderScreen('quarantine', makeSnapshot(), 120, 1)
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('Quarantine')
    expect(out).toContain('STORAGE')
  })

  it('should dispatch to renderPool for pool screen', () => {
    renderScreen('pool', makeSnapshot(), 120, 1)
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('Hound Pool')
    expect(out).toContain('POOL STATE')
  })

  it('should dispatch to renderAgent for agent screen', () => {
    renderScreen('agent', makeSnapshot(), 120, 1)
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('Agent')
    expect(out).toContain('FLOW')
  })

  it('should dispatch to renderHelp for help screen', () => {
    renderScreen('help', makeSnapshot(), 120, 1)
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('NAVIGATION')
  })

  it('should render overview in extended mode when width exceeds 140', () => {
    renderScreen('overview', makeSnapshot(), 160, 1)
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('SUBSYSTEMS')
  })
})

// ── renderDashboard (overview) ────────────────────────────────────────────

describe('renderDashboard overview branches', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    logSpy.mockRestore()
  })

  it('should render compact SUBSYSTEMS when width < 100', () => {
    renderScreen('overview', makeSnapshot(), 80, 1)
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('SUBSYSTEMS')
    expect(out).toContain('Agent')
  })

  it('should render WARNING section when archive failures exist', () => {
    renderScreen(
      'overview',
      makeSnapshot({
        quarantine: {
          count: 5,
          bytes: 1024,
          maxBytes: 8192,
          bySeverity: { critical: 1, high: 1, medium: 1, low: 1 },
          archiveFailures: 1,
          dropped: 0,
          nextExpiryAt: null,
        },
      }),
      120,
      1,
    )
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('WARNING')
    expect(out).toContain('Archive Failure')
  })

  it('should render WARNING section when agent errors exist', () => {
    renderScreen(
      'overview',
      makeSnapshot({
        system: { version: '1.0.0', uptime: '5m', health: 'healthy' },
        agent: {
          total: 10,
          clean: 8,
          quarantined: 1,
          rateLimited: 0,
          ignored: 0,
          validationFailures: 0,
          membraneRejections: 0,
          errors: 2,
        },
      }),
      120,
      1,
    )
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('WARNING')
    expect(out).toContain('Agent Error')
  })

  it('should render overview with lastAlert populated in WATCHER section', () => {
    renderScreen('overview', makeSnapshot(), 120, 1)
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('rate_limited @ 10:00:00')
  })

  it('should render NOMINAL quarantine when no failures or drops', () => {
    renderScreen('overview', makeSnapshot(), 120, 1)
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('NOMINAL')
  })

  it('should render nextExpiryAt duration in SUBSYSTEMS when nextExpiryAt is set', () => {
    const frozenNow = 1_700_000_000_000
    vi.useFakeTimers()
    vi.setSystemTime(frozenNow)
    try {
      renderScreen(
        'overview',
        makeSnapshot({
          quarantine: {
            count: 3,
            bytes: 1024,
            maxBytes: 8192,
            bySeverity: { critical: 1, high: 1, medium: 1, low: 0 },
            archiveFailures: 0,
            dropped: 0,
            nextExpiryAt: frozenNow + 120_000,
          },
        }),
        120,
        1,
      )
      const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(out).toContain('SUBSYSTEMS')
      // fmtDuration for exactly 120s produces "2m"
      expect(out).toContain('2m')
    } finally {
      vi.useRealTimers()
    }
  })
})

// ── renderQuarantine edge branches ───────────────────────────────────────

describe('renderQuarantine edge branches', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    logSpy.mockRestore()
  })

  it('should render 0.0% usage when maxBytes is zero', () => {
    renderQuarantine(
      makeSnapshot({
        quarantine: {
          count: 0,
          bytes: 0,
          maxBytes: 0,
          bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
          archiveFailures: 0,
          dropped: 0,
          nextExpiryAt: null,
        },
      }),
      120,
    )
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('0.0%')
  })
})

// ── startDashboard TTY key navigation ────────────────────────────────────

describe('startDashboard TTY mode', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let setIntervalSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>
  let processOnSpy: ReturnType<typeof vi.spyOn>
  let stdinOnSpy: ReturnType<typeof vi.spyOn>
  let setRawModeMock: ReturnType<typeof vi.fn>
  let stdinDataHandler: ((key: string) => void) | null = null
  let sigintHandler: (() => void) | null = null
  let previousSnapshotPath: string | undefined
  let previousSnapshotSecret: string | undefined
  let fixtureDir = ''

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'tracehound-tty-'))
    previousSnapshotPath = process.env[SYSTEM_SNAPSHOT_ENV.PATH]
    previousSnapshotSecret = process.env[SYSTEM_SNAPSHOT_ENV.SECRET]

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    setIntervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockImplementation(() => 0 as unknown as NodeJS.Timeout) as ReturnType<typeof vi.spyOn>
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never) as ReturnType<
      typeof vi.spyOn
    >
    processOnSpy = vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      listener: (...args: unknown[]) => void,
    ) => {
      if (event === 'SIGINT') sigintHandler = () => listener()
      return process
    }) as typeof process.on) as ReturnType<typeof vi.spyOn>

    // Simulate a TTY stdin
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
      writable: true,
    })
    setRawModeMock = vi.fn().mockReturnValue(process.stdin)
    Object.defineProperty(process.stdin, 'setRawMode', {
      value: setRawModeMock,
      configurable: true,
      writable: true,
    })
    vi.spyOn(process.stdin, 'resume').mockReturnValue(process.stdin)
    vi.spyOn(process.stdin, 'setEncoding').mockReturnValue(process.stdin)
    stdinOnSpy = vi.spyOn(process.stdin, 'on').mockImplementation(((
      event: string,
      handler: (...args: unknown[]) => void,
    ) => {
      if (event === 'data') stdinDataHandler = handler as (key: string) => void
      return process.stdin
    }) as typeof process.stdin.on) as ReturnType<typeof vi.spyOn>
  })

  afterEach(() => {
    logSpy.mockRestore()
    setIntervalSpy.mockRestore()
    exitSpy.mockRestore()
    processOnSpy.mockRestore()
    stdinOnSpy.mockRestore()
    vi.restoreAllMocks()
    stdinDataHandler = null
    sigintHandler = null
    rmSync(fixtureDir, { recursive: true, force: true })
    Object.defineProperty(process.stdin, 'isTTY', {
      value: undefined,
      configurable: true,
      writable: true,
    })

    if (previousSnapshotPath === undefined) {
      delete process.env[SYSTEM_SNAPSHOT_ENV.PATH]
    } else {
      process.env[SYSTEM_SNAPSHOT_ENV.PATH] = previousSnapshotPath
    }
    if (previousSnapshotSecret === undefined) {
      delete process.env[SYSTEM_SNAPSHOT_ENV.SECRET]
    } else {
      process.env[SYSTEM_SNAPSHOT_ENV.SECRET] = previousSnapshotSecret
    }
  })

  function launchTTYDashboard(): void {
    const snapshotPath = join(fixtureDir, 'system-snapshot.json')
    process.env[SYSTEM_SNAPSHOT_ENV.PATH] = snapshotPath
    process.env[SYSTEM_SNAPSHOT_ENV.SECRET] = SNAPSHOT_SECRET
    writeFixtureSnapshotToDisk(createFixtureSnapshot(), snapshotPath, SNAPSHOT_SECRET)
    watchCommand.exitOverride()
    watchCommand.parse(['watch', '--refresh', '250'], { from: 'user' })
  }

  it('should enter raw mode and register key handler when stdin is TTY', () => {
    launchTTYDashboard()
    expect(setRawModeMock).toHaveBeenCalledWith(true)
    expect(stdinDataHandler).not.toBeNull()
  })

  it('should switch to overview screen on key "1"', () => {
    launchTTYDashboard()
    stdinDataHandler?.('2') // navigate away first
    logSpy.mockClear()
    stdinDataHandler?.('1')
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('Tracehound Watcher')
  })

  it('should switch to watcher screen on key "2"', () => {
    launchTTYDashboard()
    logSpy.mockClear()
    stdinDataHandler?.('2')
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('Watcher')
  })

  it('should switch to quarantine screen on key "3"', () => {
    launchTTYDashboard()
    logSpy.mockClear()
    stdinDataHandler?.('3')
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('Quarantine')
  })

  it('should switch to pool screen on key "4"', () => {
    launchTTYDashboard()
    logSpy.mockClear()
    stdinDataHandler?.('4')
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('Hound Pool')
  })

  it('should switch to agent screen on key "5"', () => {
    launchTTYDashboard()
    logSpy.mockClear()
    stdinDataHandler?.('5')
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('Agent')
  })

  it('should switch to help screen on key "h"', () => {
    launchTTYDashboard()
    logSpy.mockClear()
    stdinDataHandler?.('h')
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('NAVIGATION')
  })

  it('should re-render current screen on key "r"', () => {
    launchTTYDashboard()
    logSpy.mockClear()
    stdinDataHandler?.('r')
    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(out).toContain('Tracehound Watcher')
  })

  it('should call cleanup with setRawMode(false) on key "q"', () => {
    launchTTYDashboard()
    stdinDataHandler?.('q')
    expect(setRawModeMock).toHaveBeenCalledWith(false)
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('should call cleanup on Ctrl+C (\\u0003) key', () => {
    launchTTYDashboard()
    stdinDataHandler?.('\u0003')
    expect(setRawModeMock).toHaveBeenCalledWith(false)
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('should call setRawMode(false) on SIGINT when stdin is TTY', () => {
    launchTTYDashboard()
    sigintHandler?.()
    expect(setRawModeMock).toHaveBeenCalledWith(false)
    expect(exitSpy).toHaveBeenCalledWith(0)
  })
})
