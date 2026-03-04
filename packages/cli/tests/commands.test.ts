import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordTraceInspectionEntry } from '@tracehound/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { diskCommand } from '../src/commands/disk.js'
import { historyCommand } from '../src/commands/history.js'
import { inspectCommand } from '../src/commands/inspect.js'
import { statsCommand } from '../src/commands/stats.js'
import { statusCommand } from '../src/commands/status.js'
import { watchCommand } from '../src/commands/watch.js'

const require = createRequire(import.meta.url)
const { version: cliVersion } = require('../package.json')

const SEEDED_TRACE_ID = 'trace-seeded-0001'
const SEEDED_SIGNATURE = 'injection:seeded-signature'

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
    let logSpy: any
    let previousRegistryPath: string | undefined
    let registryDir = ''

    beforeEach(() => {
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      previousRegistryPath = process.env.TRACEHOUND_TRACE_REGISTRY_PATH
      registryDir = mkdtempSync(join(tmpdir(), 'tracehound-cli-registry-'))
      process.env.TRACEHOUND_TRACE_REGISTRY_PATH = join(registryDir, 'trace-registry.ndjson')

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
      const output = logSpy.mock.calls.map((call: any) => call[0]).join('\n')
      expect(output).toContain('TRACEHOUND STATUS')
    })

    it('status command action should print JSON', () => {
      statusCommand.exitOverride()
      statusCommand.parse(['status', '--json'], { from: 'user' })

      const output = logSpy.mock.calls.map((call: any) => call[0]).join('\n')
      expect(output).toContain(`"version": "${cliVersion}"`)
    })

    it('stats command action should print stats', () => {
      statsCommand.exitOverride()
      statsCommand.parse(['stats'], { from: 'user' })

      const output = logSpy.mock.calls.map((call: any) => call[0]).join('\n')
      expect(output).toContain('THREAT STATISTICS')
      expect(output).toContain('TRACE REGISTRY')
    })

    it('stats command action should print trace registry JSON snapshot', () => {
      statsCommand.exitOverride()
      statsCommand.parse(['stats', '--json'], { from: 'user' })

      const output = logSpy.mock.calls.map((call: any) => call[0]).join('\n')
      expect(output).toContain('"traceRegistry"')
      expect(output).toContain('"retainedEntries"')
      expect(output).toContain('"path"')
    })

    it('inspect command action should print quarantine list', () => {
      inspectCommand.exitOverride()
      inspectCommand.parse(['--limit', '5'], { from: 'user' })

      const output = logSpy.mock.calls.map((call: any) => call[0]).join('\n')
      expect(output).toContain('QUARANTINE CONTENTS')
    })

    it('inspect command action should print not found message for signature', () => {
      inspectCommand.exitOverride()
      inspectCommand.parse(['--signature', 'missing-sig'], { from: 'user' })

      const output = logSpy.mock.calls.map((call: any) => call[0]).join('\n')
      expect(output).toContain('Evidence not found')
    })

    it('inspect command action should print JSON list', () => {
      inspectCommand.exitOverride()
      inspectCommand.parse(['--json'], { from: 'user' })

      const output = logSpy.mock.calls.map((call: any) => call[0]).join('\n')
      expect(output).toContain(SEEDED_TRACE_ID)
    })

    it('inspect command action should resolve trace id via option', () => {
      inspectCommand.exitOverride()
      inspectCommand.parse(['--trace-id', SEEDED_TRACE_ID], { from: 'user' })

      const output = logSpy.mock.calls.map((call: any) => call[0]).join('\n')
      expect(output).toContain('EVIDENCE DETAILS')
      expect(output).toContain(SEEDED_TRACE_ID)
    })

    it('inspect command action should resolve trace id via positional argument', () => {
      inspectCommand.exitOverride()
      inspectCommand.parse([SEEDED_TRACE_ID, '--json'], { from: 'user' })

      const output = logSpy.mock.calls.map((call: any) => call[0]).join('\n')
      expect(output).toContain('"traceId": "trace-seeded-0001"')
      expect(output).not.toContain('"bytes"')
    })

    it('history clear should clear retained history explicitly', () => {
      historyCommand.exitOverride()
      historyCommand.parse(['clear', '--json'], { from: 'user' })

      const output = logSpy.mock.calls.map((call: any) => call[0]).join('\n')
      expect(output).toContain('"mode": "history"')
      expect(output).toContain('"success": true')

      logSpy.mockClear()

      inspectCommand.exitOverride()
      inspectCommand.parse(['--json'], { from: 'user' })

      const inspectOutput = logSpy.mock.calls.map((call: any) => call[0]).join('\n')
      expect(inspectOutput).toContain('[]')
    })

    it('disk clear should remove registry file explicitly', () => {
      const registryPath = process.env.TRACEHOUND_TRACE_REGISTRY_PATH
      expect(registryPath).toBeTruthy()

      diskCommand.exitOverride()
      diskCommand.parse(['clear', '--json'], { from: 'user' })

      const output = logSpy.mock.calls.map((call: any) => call[0]).join('\n')
      expect(output).toContain('"mode": "disk"')
      expect(output).toContain('"success": true')

      expect(existsSync(registryPath as string)).toBe(false)
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
    let logSpy: any

    beforeEach(() => {
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    })

    afterEach(() => {
      logSpy.mockRestore()
    })

    it('should get system snapshot', async () => {
      const { getSnapshot } = await import('../src/commands/watch.js')
      const snapshot = getSnapshot()
      expect(snapshot.system.version).toBe(cliVersion)
      expect(snapshot.timestamp).toBeDefined()
    })

    it('should render dashboard without errors', async () => {
      const { renderDashboard, getSnapshot } = await import('../src/commands/watch.js')
      const snapshot = getSnapshot()

      renderDashboard(snapshot, 1000)

      const output = logSpy.mock.calls.map((call: any) => call[0]).join('\n')
      expect(output).toContain('TRACEHOUND LIVE DASHBOARD')
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
