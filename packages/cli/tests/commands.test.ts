import {
  recordTraceInspectionEntry,
  SYSTEM_SNAPSHOT_ENV,
  type SystemSnapshot,
} from '@tracehound/core'
import { createHmac } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { diskCommand } from '../src/commands/disk.js'
import { historyCommand } from '../src/commands/history.js'
import { inspectCommand } from '../src/commands/inspect.js'
import { statsCommand } from '../src/commands/stats.js'
import { statusCommand } from '../src/commands/status.js'
import { watchCommand } from '../src/commands/watch.js'

const SEEDED_TRACE_ID = 'trace-seeded-0001'
const SEEDED_SIGNATURE = 'injection:seeded-signature'
const SNAPSHOT_SECRET = 'tracehound-cli-test-snapshot-secret'

type ConsoleLogSpy = ReturnType<typeof vi.spyOn>

function createFixtureSnapshot(): SystemSnapshot {
  const now = Date.now()
  const pressure = {
    mode: 'normal' as const,
    archiveSuppressed: false,
    updatedAt: now,
    signals: {
      quarantineBytes: 4096,
      quarantineCount: 4,
      quarantineCapacityPercent: 50,
      droppedEvents: 1,
      archiveFailureCount: 0,
      houndPressureEvents: 0,
      overloaded: false,
    },
  }

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
      evictedCount: 0,
      decayedCount: 0,
      archivedCount: 0,
      archiveFailureCount: 0,
      ttlEnabled: false,
      nextExpiryAt: null,
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
      pressure,
      snapshotTime: now,
      quarantine: {
        count: 4,
        bytes: 4096,
        capacityPercent: 50,
      },
    },
    pressure,
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

function readLogOutput(logSpy: ConsoleLogSpy): string {
  return logSpy.mock.calls.map((call) => String(call[0])).join('\n')
}

describe('CLI Commands', () => {
  describe('Smoke tests', () => {
    it('should have inspect command', async () => {
      const { inspectCommand } = await import('../src/commands/inspect.js')
      expect(inspectCommand).toBeDefined()
      expect(typeof inspectCommand).toBe('object')
    })

    it('should have stats command', async () => {
      const { statsCommand } = await import('../src/commands/stats.js')
      expect(statsCommand).toBeDefined()
      expect(typeof statsCommand).toBe('object')
    })

    it('should have status command', async () => {
      const { statusCommand } = await import('../src/commands/status.js')
      expect(statusCommand).toBeDefined()
      expect(typeof statusCommand).toBe('object')
    })

    it('should have watch command', async () => {
      const { watchCommand } = await import('../src/commands/watch.js')
      expect(watchCommand).toBeDefined()
      expect(typeof watchCommand).toBe('object')
    })

    it('should have history command', async () => {
      const { historyCommand } = await import('../src/commands/history.js')
      expect(historyCommand).toBeDefined()
      expect(typeof historyCommand).toBe('object')
    })

    it('should have disk command', async () => {
      const { diskCommand } = await import('../src/commands/disk.js')
      expect(diskCommand).toBeDefined()
      expect(typeof diskCommand).toBe('object')
    })
  })

  describe('Command structure', () => {
    it('inspect command should be a Commander command', async () => {
      const { inspectCommand } = await import('../src/commands/inspect.js')
      expect(inspectCommand.name()).toBe('inspect')
      expect(inspectCommand.description()).toBeTruthy()
    })

    it('inspect command should support trace-id option', async () => {
      const { inspectCommand } = await import('../src/commands/inspect.js')
      const traceIdOption = inspectCommand.options.find((option) => option.long === '--trace-id')
      expect(traceIdOption).toBeDefined()
    })

    it('stats command should be a Commander command', async () => {
      const { statsCommand } = await import('../src/commands/stats.js')
      expect(statsCommand.name()).toBe('stats')
      expect(statsCommand.description()).toBeTruthy()
    })

    it('status command should be a Commander command', async () => {
      const { statusCommand } = await import('../src/commands/status.js')
      expect(statusCommand.name()).toBe('status')
      expect(statusCommand.description()).toBeTruthy()
    })

    it('watch command should be a Commander command', () => {
      expect(watchCommand.name()).toBe('watch')
      expect(watchCommand.description()).toBeTruthy()
    })

    it('history command should expose clear subcommand', () => {
      expect(historyCommand.name()).toBe('history')
      expect(historyCommand.commands.map((command) => command.name())).toContain('clear')
    })

    it('disk command should expose clear subcommand', () => {
      expect(diskCommand.name()).toBe('disk')
      expect(diskCommand.commands.map((command) => command.name())).toContain('clear')
    })
  })

  describe('Command execution', () => {
    let logSpy: ConsoleLogSpy
    let previousRegistryPath: string | undefined
    let previousSnapshotPath: string | undefined
    let previousSnapshotSecret: string | undefined
    let registryDir = ''
    let snapshotPath = ''

    beforeEach(() => {
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      previousRegistryPath = process.env.TRACEHOUND_TRACE_REGISTRY_PATH
      previousSnapshotPath = process.env[SYSTEM_SNAPSHOT_ENV.PATH]
      previousSnapshotSecret = process.env[SYSTEM_SNAPSHOT_ENV.SECRET]
      registryDir = mkdtempSync(join(tmpdir(), 'tracehound-cli-registry-'))
      process.env.TRACEHOUND_TRACE_REGISTRY_PATH = join(registryDir, 'trace-registry.ndjson')
      snapshotPath = join(registryDir, 'system-snapshot.json')
      process.env[SYSTEM_SNAPSHOT_ENV.PATH] = snapshotPath
      process.env[SYSTEM_SNAPSHOT_ENV.SECRET] = SNAPSHOT_SECRET
      writeFixtureSnapshotToDisk(createFixtureSnapshot(), snapshotPath, SNAPSHOT_SECRET)

      recordTraceInspectionEntry({
        traceId: SEEDED_TRACE_ID,
        signature: SEEDED_SIGNATURE,
        severity: 'high',
        size: 1536,
        captured: 1_772_520_000_000,
        source: '127.0.0.1',
      })
      recordTraceInspectionEntry({
        traceId: 'trace-seeded-0002',
        signature: 'ddos:seeded-signature',
        severity: 'medium',
        size: 4096,
        captured: 1_772_520_060_000,
        source: '10.0.0.45',
      })
    })

    afterEach(() => {
      logSpy.mockRestore()

      rmSync(registryDir, { recursive: true, force: true })
      if (previousRegistryPath === undefined) {
        delete process.env.TRACEHOUND_TRACE_REGISTRY_PATH
      } else {
        process.env.TRACEHOUND_TRACE_REGISTRY_PATH = previousRegistryPath
      }

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

      // Reset commander options to avoid state leakage
      inspectCommand.setOptionValue('signature', undefined)
      inspectCommand.setOptionValue('traceId', undefined)
      inspectCommand.setOptionValue('limit', '10')
      inspectCommand.setOptionValue('json', undefined)
      statusCommand.setOptionValue('json', undefined)
      statsCommand.setOptionValue('json', undefined)
      statsCommand.setOptionValue('since', '24h')
    })

    it('status command action should print status', () => {
      statusCommand.exitOverride()
      statusCommand.parse(['status'], { from: 'user' })

      expect(logSpy).toHaveBeenCalled()
      const output = readLogOutput(logSpy)
      expect(output).toContain('TRACEHOUND STATUS')
    })

    it('status command action should print JSON', () => {
      statusCommand.exitOverride()
      statusCommand.parse(['status', '--json'], { from: 'user' })

      const output = readLogOutput(logSpy)
      expect(output).toContain('"connected": true')
      expect(output).toContain('"health": "degraded"')
    })

    it('stats command action should print stats', () => {
      statsCommand.exitOverride()
      statsCommand.parse(['stats'], { from: 'user' })

      const output = readLogOutput(logSpy)
      expect(output).toContain('THREAT STATISTICS')
      expect(output).toContain('TRACE REGISTRY')
    })

    it('stats command action should print trace registry JSON snapshot', () => {
      statsCommand.exitOverride()
      statsCommand.parse(['stats', '--json'], { from: 'user' })

      const output = readLogOutput(logSpy)
      expect(output).toContain('"connected": true')
      expect(output).toContain('"traceRegistry"')
      expect(output).toContain('"retainedEntries"')
      expect(output).toContain('"path"')
    })

    it('status command should report NO_INSTANCE when snapshot is missing', () => {
      rmSync(snapshotPath, { force: true })

      statusCommand.exitOverride()
      statusCommand.parse(['status', '--json'], { from: 'user' })

      const output = readLogOutput(logSpy)
      expect(output).toContain('"connected": false')
      expect(output).toContain('"error": "NO_INSTANCE"')
    })

    it('status command should print snapshot unavailable banner when snapshot is missing', () => {
      rmSync(snapshotPath, { force: true })

      statusCommand.exitOverride()
      statusCommand.parse(['status'], { from: 'user' })

      const output = readLogOutput(logSpy)
      expect(output).toContain('Snapshot unavailable: NO_INSTANCE')
    })

    it('stats command should print snapshot unavailable when snapshot is missing', () => {
      rmSync(snapshotPath, { force: true })

      statsCommand.exitOverride()
      statsCommand.parse(['stats'], { from: 'user' })

      const output = readLogOutput(logSpy)
      expect(output).toContain('Snapshot unavailable: NO_INSTANCE')
    })

    it('stats command JSON should return explicit disconnected error payload when snapshot is missing', () => {
      rmSync(snapshotPath, { force: true })

      statsCommand.exitOverride()
      statsCommand.parse(['stats', '--json'], { from: 'user' })

      const output = readLogOutput(logSpy)
      expect(output).toContain('"connected": false')
      expect(output).toContain('"error": "NO_INSTANCE"')
      expect(output).toContain('"path"')
      expect(output).not.toContain('"total":')
    })

    it('inspect command action should print quarantine list', () => {
      inspectCommand.exitOverride()
      inspectCommand.parse(['--limit', '5'], { from: 'user' })

      const output = readLogOutput(logSpy)
      expect(output).toContain('QUARANTINE CONTENTS')
    })

    it('inspect command action should print not found message for signature', () => {
      inspectCommand.exitOverride()
      inspectCommand.parse(['--signature', 'missing-sig'], { from: 'user' })

      const output = readLogOutput(logSpy)
      expect(output).toContain('Evidence not found')
    })

    it('inspect command action should print JSON list', () => {
      inspectCommand.exitOverride()
      inspectCommand.parse(['--json'], { from: 'user' })

      const output = readLogOutput(logSpy)
      expect(output).toContain(SEEDED_TRACE_ID)
    })

    it('inspect command action should resolve trace id via option', () => {
      inspectCommand.exitOverride()
      inspectCommand.parse(['--trace-id', SEEDED_TRACE_ID], { from: 'user' })

      const output = readLogOutput(logSpy)
      expect(output).toContain('EVIDENCE DETAILS')
      expect(output).toContain(SEEDED_TRACE_ID)
    })

    it('inspect command action should resolve trace id via positional argument', () => {
      inspectCommand.exitOverride()
      inspectCommand.parse([SEEDED_TRACE_ID, '--json'], { from: 'user' })

      const output = readLogOutput(logSpy)
      expect(output).toContain('"traceId": "trace-seeded-0001"')
      expect(output).not.toContain('"bytes"')
    })

    it('history clear should clear retained history explicitly', () => {
      historyCommand.exitOverride()
      historyCommand.parse(['clear', '--json'], { from: 'user' })

      const output = readLogOutput(logSpy)
      expect(output).toContain('"mode": "history"')
      expect(output).toContain('"success": true')

      logSpy.mockClear()

      inspectCommand.exitOverride()
      inspectCommand.parse(['--json'], { from: 'user' })

      const inspectOutput = readLogOutput(logSpy)
      expect(inspectOutput).toContain('[]')
    })

    it('history clear should print table output when json flag is not provided', () => {
      historyCommand.commands[0]?.setOptionValue('json', undefined)
      historyCommand.exitOverride()
      historyCommand.parse(['clear'], { from: 'user' })

      const output = readLogOutput(logSpy)
      expect(output).toContain('HISTORY CLEAR')
      expect(output).toContain('Removed Entries')
    })

    it('disk clear should remove registry file explicitly', () => {
      const registryPath = process.env.TRACEHOUND_TRACE_REGISTRY_PATH
      expect(registryPath).toBeTruthy()

      diskCommand.exitOverride()
      diskCommand.parse(['clear', '--json'], { from: 'user' })

      const output = readLogOutput(logSpy)
      expect(output).toContain('"mode": "disk"')
      expect(output).toContain('"success": true')

      if (typeof registryPath !== 'string') {
        expect.fail('TRACEHOUND_TRACE_REGISTRY_PATH must be set in test setup')
        return
      }
      expect(existsSync(registryPath)).toBe(false)
    })

    it('disk clear should print table output when json flag is not provided', () => {
      diskCommand.commands[0]?.setOptionValue('json', undefined)
      diskCommand.exitOverride()
      diskCommand.parse(['clear'], { from: 'user' })

      const output = readLogOutput(logSpy)
      expect(output).toContain('DISK CLEAR')
      expect(output).toContain('Removed Bytes')
    })
  })

  describe('Stats edge branches', () => {
    it('stats command should emit fileUsagePct 0 when maxFileBytes is zero', async () => {
      vi.resetModules()
      vi.doMock('@tracehound/core', () => ({
        getTraceRegistryStats: () => ({
          path: '/tmp/trace-registry.ndjson',
          fileExists: true,
          retainedEntries: 1,
          uniqueTraceIds: 1,
          fileBytes: 256,
          maxFileBytes: 0,
          queueDepth: 0,
          maxQueueEntries: 1024,
          droppedCount: 0,
          blocked: false,
          ttlMs: 86_400_000,
          maxEntries: 5000,
        }),
      }))
      vi.doMock('../src/lib/system-snapshot.js', () => ({
        loadSystemSnapshot: () => ({
          ok: true,
          snapshot: createFixtureSnapshot(),
        }),
      }))

      const mockedLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      try {
        const { statsCommand: isolatedStatsCommand } = await import('../src/commands/stats.js')
        isolatedStatsCommand.exitOverride()
        isolatedStatsCommand.parse(['stats', '--json'], { from: 'user' })

        const output = readLogOutput(mockedLogSpy)
        expect(output).toContain('"fileUsagePct": 0')
      } finally {
        mockedLogSpy.mockRestore()
        vi.doUnmock('@tracehound/core')
        vi.doUnmock('../src/lib/system-snapshot.js')
        vi.resetModules()
      }
    })
  })

  describe('Theme Utilities', () => {
    it('color functions should return ANSI strings', async () => {
      const { primary, secondary, accent, muted, bold, success, warning, error } =
        await import('../src/lib/theme.js')

      expect(primary('test')).toContain('\x1b[38;5;75m')
      expect(secondary('test')).toContain('\x1b[38;5;183m')
      expect(accent('test')).toContain('\x1b[38;5;114m')
      expect(muted('test')).toContain('\x1b[38;5;245m')
      expect(bold('test')).toContain('\x1b[1m')
      expect(success('test')).toContain('\x1b[38;5;114m')
      expect(warning('test')).toContain('\x1b[38;5;215m')
      expect(error('test')).toContain('\x1b[38;5;203m')
    })

    it('severity function should return colored labels', async () => {
      const { severity } = await import('../src/lib/theme.js')

      expect(severity('critical')).toContain('\x1b[38;5;203m')
      expect(severity('high')).toContain('\x1b[38;5;215m')
      expect(severity('medium')).toContain('\x1b[38;5;221m')
      expect(severity('low')).toContain('\x1b[38;5;114m')
      expect(severity('unknown')).toBe('unknown')
    })

    it('progressBar should handle different ratios', async () => {
      const { progressBar } = await import('../src/lib/theme.js')

      const p1 = progressBar(0, 100, 10)
      expect(p1).toContain('░'.repeat(10))

      const p2 = progressBar(50, 100, 10)
      expect(p2).toContain('█'.repeat(5))
      expect(p2).toContain('░'.repeat(5))

      const p3 = progressBar(100, 100, 10)
      expect(p3).toContain('█'.repeat(10))
    })

    it('cursor and screen utilities should call stdout.write', async () => {
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      const { clearScreen, hideCursor, showCursor } = await import('../src/lib/theme.js')

      clearScreen()
      expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('\x1b[2J'))

      hideCursor()
      expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('\x1b[?25l'))

      showCursor()
      expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('\x1b[?25h'))

      writeSpy.mockRestore()
    })
  })

  describe('Watch command logic', () => {
    let logSpy: ConsoleLogSpy
    let previousSnapshotPath: string | undefined
    let previousSnapshotSecret: string | undefined
    let snapshotDir = ''

    beforeEach(() => {
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      previousSnapshotPath = process.env[SYSTEM_SNAPSHOT_ENV.PATH]
      previousSnapshotSecret = process.env[SYSTEM_SNAPSHOT_ENV.SECRET]
      snapshotDir = mkdtempSync(join(tmpdir(), 'tracehound-cli-watch-'))
      process.env[SYSTEM_SNAPSHOT_ENV.PATH] = join(snapshotDir, 'system-snapshot.json')
      process.env[SYSTEM_SNAPSHOT_ENV.SECRET] = SNAPSHOT_SECRET
      writeFixtureSnapshotToDisk(
        createFixtureSnapshot(),
        process.env[SYSTEM_SNAPSHOT_ENV.PATH],
        SNAPSHOT_SECRET,
      )
    })

    afterEach(() => {
      logSpy.mockRestore()
      rmSync(snapshotDir, { recursive: true, force: true })
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

    it('should get system snapshot', async () => {
      const { getSnapshot } = await import('../src/commands/watch.js')
      const snapshot = getSnapshot()
      expect(snapshot.ok).toBe(true)
      if (snapshot.ok) {
        expect(snapshot.snapshot.systemHealth).toBe('degraded')
      }
    })

    it('should render dashboard without errors', async () => {
      const { renderDashboard, getSnapshot } = await import('../src/commands/watch.js')
      const snapshot = getSnapshot()
      expect(snapshot.ok).toBe(true)
      if (!snapshot.ok) return

      renderDashboard(
        {
          timestamp: new Date(snapshot.snapshot.generatedAt).toISOString(),
          agent: {
            total: snapshot.snapshot.agent.totalIntercepts,
            clean: snapshot.snapshot.agent.cleanCount,
            quarantined: snapshot.snapshot.agent.quarantinedCount,
            rateLimited: snapshot.snapshot.agent.rateLimitedCount,
            ignored: snapshot.snapshot.agent.ignoredCount,
            validationFailures: snapshot.snapshot.agent.validationFailures,
            membraneRejections: snapshot.snapshot.agent.membraneRejectionCount,
            errors: snapshot.snapshot.agent.errorCount,
          },
          system: {
            version: 'test',
            uptime: '1m',
            health: snapshot.snapshot.systemHealth,
          },
          pressure: {
            mode: snapshot.snapshot.pressure.mode,
            archiveSuppressed: snapshot.snapshot.pressure.archiveSuppressed,
            capacityPercent: snapshot.snapshot.pressure.signals.quarantineCapacityPercent,
            droppedEvents: snapshot.snapshot.pressure.signals.droppedEvents,
            archiveFailureCount: snapshot.snapshot.pressure.signals.archiveFailureCount,
            houndPressureEvents: snapshot.snapshot.pressure.signals.houndPressureEvents,
          },
          quarantine: {
            count: snapshot.snapshot.quarantine.count,
            bytes: snapshot.snapshot.quarantine.bytes,
            maxBytes: snapshot.snapshot.quarantineMaxBytes,
            bySeverity: snapshot.snapshot.quarantine.bySeverity,
            archiveFailures: snapshot.snapshot.quarantine.archiveFailureCount ?? 0,
            dropped: snapshot.snapshot.quarantine.droppedCount,
            nextExpiryAt: snapshot.snapshot.quarantine.nextExpiryAt ?? null,
          },
          houndPool: {
            active: snapshot.snapshot.houndPool.activeProcesses,
            dormant:
              snapshot.snapshot.houndPool.totalProcesses -
              snapshot.snapshot.houndPool.activeProcesses,
            total: snapshot.snapshot.houndPool.totalProcesses,
            totalActivations: snapshot.snapshot.houndPool.totalActivations,
            avgProcessingMs: snapshot.snapshot.houndPool.avgProcessingMs,
            totalTimeouts: snapshot.snapshot.houndPool.totalTimeouts,
            totalErrors: snapshot.snapshot.houndPool.totalErrors,
            status: 'ok',
          },
          rateLimiter: {
            sources: snapshot.snapshot.rateLimiter.sources,
            blocked: snapshot.snapshot.rateLimiter.blocked,
            totalRejections: snapshot.snapshot.rateLimiter.totalRejections,
            totalEvictions: snapshot.snapshot.rateLimiter.totalEvictions,
          },
          watcher: {
            threatTotal: snapshot.snapshot.watcher.threats.total,
            byCategory: snapshot.snapshot.watcher.threats.byCategory,
            lastAlert: null,
          },
          recentThreats: [],
        },
        1000,
      )

      const output = readLogOutput(logSpy)
      expect(output).toContain('Tracehound Watcher')
      expect(output).toContain('SYSTEM')
    })

    it('should handle dashboard options', () => {
      expect(watchCommand.options.find((o) => o.short === '-r')).toBeDefined()
    })
  })

  describe('CLI Entry Point', () => {
    it('should have all commands registered', async () => {
      const { program } = await import('../src/index.js')
      expect(program.commands.map((c) => c.name())).toEqual(
        expect.arrayContaining(['status', 'stats', 'inspect', 'watch', 'history', 'disk']),
      )
    })
  })
})
