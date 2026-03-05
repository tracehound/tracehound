import { describe, expect, it, vi } from 'vitest'
import { encodeMessage } from '../src/core/hound-ipc.js'

describe('process-adapter', () => {
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
})

