import { describe, it, expect } from 'vitest'
import { statusCommand } from '../src/commands/status.js'
import { statsCommand } from '../src/commands/stats.js'
import { inspectCommand } from '../src/commands/inspect.js'
import { watchCommand } from '../src/commands/watch.js'

describe('CLI Smoke Tests', () => {
  it('should export status command', () => {
    expect(statusCommand.name()).toBe('status')
    expect(statusCommand.description()).toContain('status')
  })

  it('should export stats command', () => {
    expect(statsCommand.name()).toBe('stats')
    expect(statsCommand.description()).toContain('statistics')
  })

  it('should export inspect command', () => {
    expect(inspectCommand.name()).toBe('inspect')
    expect(inspectCommand.description()).toContain('Inspect')
  })

  it('should export watch command', () => {
    expect(watchCommand.name()).toBe('watch')
    expect(watchCommand.description()).toContain('dashboard')
  })
})
