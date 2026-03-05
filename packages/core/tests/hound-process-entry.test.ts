import { describe, expect, it, vi } from 'vitest'
import {
  createMessageParser,
  decodeHoundMessage,
  encodeMessage,
  type HoundMessage,
} from '../src/core/hound-ipc.js'

function decodeWrittenMessages(written: Buffer[]): HoundMessage[] {
  const parser = createMessageParser()
  const payloads = parser.feed(Buffer.concat(written))
  return payloads.map((payload) => decodeHoundMessage(payload))
}

describe('hound-process entrypoint', () => {
  it('sends ready status and processes stdin payload frames', async () => {
    vi.resetModules()
    const stdinHandlers = new Map<string, (arg?: unknown) => void>()
    const written: Buffer[] = []

    const stdinOnSpy = vi
      .spyOn(process.stdin, 'on')
      .mockImplementation(((event: string, handler: (arg?: unknown) => void) => {
        stdinHandlers.set(event, handler)
        return process.stdin
      }) as typeof process.stdin.on)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(((chunk: string | Uint8Array) => {
        written.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        return true
      }) as typeof process.stdout.write)

    try {
      await import('../src/core/hound-process.js')
      const messagesAfterBoot = decodeWrittenMessages(written)
      expect(messagesAfterBoot.some((message) => message.type === 'status')).toBe(true)

      written.length = 0
      const payload = new TextEncoder().encode('{"ok":true}').buffer
      const framed = encodeMessage(payload)
      const dataHandler = stdinHandlers.get('data')
      expect(dataHandler).toBeDefined()
      dataHandler?.(framed)

      const messages = decodeWrittenMessages(written)
      expect(messages.find((message) => message.type === 'analysis')).toBeDefined()
      expect(messages.find((message) => message.type === 'metrics')).toBeDefined()
      expect(
        messages.find(
          (message) =>
            message.type === 'status' &&
            (message.state === 'processing' || message.state === 'complete'),
        ),
      ).toBeDefined()

      expect(exitSpy).not.toHaveBeenCalled()
    } finally {
      stdinOnSpy.mockRestore()
      exitSpy.mockRestore()
      stdoutSpy.mockRestore()
    }
  })

  it('handles stdin end/error and process-level failure hooks', async () => {
    vi.resetModules()
    const stdinHandlers = new Map<string, (arg?: unknown) => void>()
    const processHandlers = new Map<string, (arg?: unknown) => void>()
    const written: Buffer[] = []

    const stdinOnSpy = vi
      .spyOn(process.stdin, 'on')
      .mockImplementation(((event: string, handler: (arg?: unknown) => void) => {
        stdinHandlers.set(event, handler)
        return process.stdin
      }) as typeof process.stdin.on)
    const processOnSpy = vi
      .spyOn(process, 'on')
      .mockImplementation(((event: string, handler: (arg?: unknown) => void) => {
        processHandlers.set(event, handler)
        return process
      }) as typeof process.on)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(((chunk: string | Uint8Array) => {
        written.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        return true
      }) as typeof process.stdout.write)

    try {
      await import('../src/core/hound-process.js')

      stdinHandlers.get('end')?.()
      expect(exitSpy).toHaveBeenCalledWith(0)

      stdinHandlers.get('error')?.(new Error('stdin-failed'))
      processHandlers.get('uncaughtException')?.(new Error('panic'))
      processHandlers.get('unhandledRejection')?.('reject-reason')

      const messages = decodeWrittenMessages(written)
      expect(
        messages.some(
          (message) =>
            message.type === 'status' &&
            message.state === 'error' &&
            (message.error?.includes('stdin error: stdin-failed') ||
              message.error?.includes('uncaught: panic') ||
              message.error?.includes('unhandled rejection: reject-reason')),
        ),
      ).toBe(true)
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      stdinOnSpy.mockRestore()
      processOnSpy.mockRestore()
      exitSpy.mockRestore()
      stdoutSpy.mockRestore()
    }
  })
})
