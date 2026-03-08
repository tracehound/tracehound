import { describe, expect, it, vi } from 'vitest'
import { encodeMessage } from '../src/core/hound-ipc.js'

describe('process-adapter', () => {
  it('reports isolation telemetry with defaults', async () => {
    const { getProcessIsolationTelemetry } = await import('../src/core/process-adapter.js')
    const telemetry = getProcessIsolationTelemetry(undefined, 'linux')

    expect(telemetry.constraints.maxMemoryMB).toBe(128)
    expect(telemetry.capabilities.platform).toBe('linux')
    expect(telemetry.capabilities.memoryLimit).toBe('enforced')
    expect(telemetry.capabilities.environmentIsolation).toBe('allowlist')
    expect(telemetry.environmentAllowlistSize).toBeGreaterThan(0)
  })

  it('normalizes unknown platform and declarative memory limit in telemetry', async () => {
    const { getProcessIsolationTelemetry } = await import('../src/core/process-adapter.js')
    const telemetry = getProcessIsolationTelemetry(
      {
        maxMemoryMB: 0,
      },
      'plan9' as NodeJS.Platform,
    )

    expect(telemetry.constraints.maxMemoryMB).toBe(0)
    expect(telemetry.capabilities.platform).toBe('unknown')
    expect(telemetry.capabilities.memoryLimit).toBe('declarative')
    expect(Object.isFrozen(telemetry.constraints)).toBe(true)
    expect(Object.isFrozen(telemetry.capabilities)).toBe(true)
  })

  it('treats fractional maxMemoryMB as declarative and omits memory arg', async () => {
    let capturedArgs: string[] | undefined

    vi.resetModules()
    vi.doMock('node:child_process', () => ({
      spawn: (_command: string, args: string[]) => {
        capturedArgs = args
        return {
          pid: 7777,
          stdin: null,
          stdout: null,
          on: () => {},
          kill: () => true,
        } as unknown
      },
    }))

    const { createProcessAdapter, getProcessIsolationTelemetry } =
      await import('../src/core/process-adapter.js')

    const telemetry = getProcessIsolationTelemetry({ maxMemoryMB: 64.5 }, 'linux')
    expect(telemetry.capabilities.memoryLimit).toBe('declarative')

    const adapter = createProcessAdapter()
    adapter.spawn('noop.js', { maxMemoryMB: 64.5 })

    expect(capturedArgs?.some((arg) => arg.startsWith('--max-old-space-size='))).toBe(false)
    vi.doUnmock('node:child_process')
  })

  it('throws when spawned child has no pid', async () => {
    vi.resetModules()
    vi.doMock('node:child_process', () => ({
      spawn: () =>
        ({
          pid: undefined,
          stdin: null,
          stdout: null,
          on: () => {},
        }) as unknown,
    }))

    const { createProcessAdapter } = await import('../src/core/process-adapter.js')
    const adapter = createProcessAdapter()
    expect(() => adapter.spawn('noop.js')).toThrow(/spawn process/i)
    vi.doUnmock('node:child_process')
  })

  it('handles backpressure drain and stdout message dispatch', async () => {
    let onData: ((chunk: Buffer) => void) | null = null
    const onceSpy = vi.fn()
    const writeSpy = vi.fn(() => false)

    vi.resetModules()
    vi.doMock('node:child_process', () => ({
      spawn: () =>
        ({
          pid: 1234,
          stdin: {
            destroyed: false,
            write: writeSpy,
            once: onceSpy,
          },
          stdout: {
            on: (event: string, callback: (chunk: Buffer) => void) => {
              if (event === 'data') {
                onData = callback
              }
            },
          },
          on: () => {},
          kill: () => {},
        }) as unknown,
    }))

    const { createProcessAdapter } = await import('../src/core/process-adapter.js')
    const adapter = createProcessAdapter()
    const handle = adapter.spawn('noop.js')

    adapter.send(handle, new Uint8Array([0x01, 0x02]).buffer)
    expect(writeSpy).toHaveBeenCalled()
    expect(onceSpy).toHaveBeenCalledWith('drain', expect.any(Function))

    let received: ArrayBuffer | null = null
    adapter.onMessage(handle, (payload) => {
      received = payload
    })

    const payload = new Uint8Array([0x11, 0x22]).buffer
    const framed = encodeMessage(payload)
    onData?.(framed)

    expect(received).not.toBeNull()
    expect(Buffer.from(received as ArrayBuffer)).toEqual(Buffer.from(payload))

    vi.doUnmock('node:child_process')
  })

  it('includes mixed-case Path in child env when PATH is missing', async () => {
    const previousPathUpper = process.env.PATH
    const previousPathMixed = process.env.Path
    const mixedPathValue = 'C:\\Windows\\System32'
    let capturedEnv: NodeJS.ProcessEnv | undefined

    try {
      delete process.env.PATH
      process.env.Path = mixedPathValue

      vi.resetModules()
      vi.doMock('node:child_process', () => ({
        spawn: (_command: string, _args: string[], options: { env?: NodeJS.ProcessEnv }) => {
          capturedEnv = options.env
          return {
            pid: 4321,
            stdin: null,
            stdout: null,
            on: () => {},
            kill: () => true,
          } as unknown
        },
      }))

      const { createProcessAdapter } = await import('../src/core/process-adapter.js')
      const adapter = createProcessAdapter()
      adapter.spawn('noop.js')

      expect(capturedEnv?.Path).toBe(mixedPathValue)
    } finally {
      if (previousPathUpper === undefined) {
        delete process.env.PATH
      } else {
        process.env.PATH = previousPathUpper
      }
      if (previousPathMixed === undefined) {
        delete process.env.Path
      } else {
        process.env.Path = previousPathMixed
      }
      vi.doUnmock('node:child_process')
    }
  })
})
