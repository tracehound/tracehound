import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inspectCommand } from '../src/commands/inspect.js'
import { statsCommand } from '../src/commands/stats.js'
import { statusCommand } from '../src/commands/status.js'
import { watchCommand } from '../src/commands/watch.js'

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
  })

  describe('Command structure', () => {
    it('inspect command should be a Commander command', async () => {
      const { inspectCommand } = await import('../src/commands/inspect.js')
      expect(inspectCommand.name()).toBe('inspect')
      expect(inspectCommand.description()).toBeTruthy()
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
  })

  describe('Command execution', () => {
    let logSpy: any

    beforeEach(() => {
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    })

    afterEach(() => {
      logSpy.mockRestore()
      // Reset commander options to avoid state leakage
      inspectCommand.setOptionValue('signature', undefined)
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
      // Look for a known string in the output
      const output = logSpy.mock.calls.map((call: any) => call[0]).join('\n')
      expect(output).toContain('TRACEHOUND STATUS')
    })

    it('status command action should print JSON', () => {
      statusCommand.exitOverride()
      statusCommand.parse(['status', '--json'], { from: 'user' })

      const output = logSpy.mock.calls.map((call: any) => call[0]).join('\n')
      expect(output).toContain('"version": "0.1.0"')
    })

    it('stats command action should print stats', () => {
      statsCommand.exitOverride()
      statsCommand.parse(['stats'], { from: 'user' })

      const output = logSpy.mock.calls.map((call: any) => call[0]).join('\n')
      expect(output).toContain('THREAT STATISTICS')
    })

    it('inspect command action should print empty quarantine message', () => {
      inspectCommand.exitOverride()
      inspectCommand.parse(['inspect', '--limit', '5'], { from: 'user' })

      const output = logSpy.mock.calls.map((call: any) => call[0]).join('\n')
      expect(output).toContain('Quarantine is empty')
    })

    it('inspect command action should print not found message for signature', () => {
      inspectCommand.exitOverride()
      inspectCommand.parse(['inspect', '--signature', 'missing-sig'], { from: 'user' })

      const output = logSpy.mock.calls.map((call: any) => call[0]).join('\n')
      expect(output).toContain('Evidence not found')
    })

    it('inspect command action should print JSON list', () => {
      inspectCommand.exitOverride()
      inspectCommand.parse(['inspect', '--json'], { from: 'user' })

      const output = logSpy.mock.calls.map((call: any) => call[0]).join('\n')
      expect(output).toContain('[]')
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
      expect(snapshot.system.version).toBe('0.1.0')
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
        expect.arrayContaining(['status', 'stats', 'inspect', 'watch']),
      )
    })
  })
})
