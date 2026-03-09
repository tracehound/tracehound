/**
 * Express middleware tests.
 */

import type { IAgent, InterceptResult, RuntimeEvidenceHandle } from '@tracehound/core'
import type { NextFunction, Request, Response } from 'express'
import { Buffer } from 'node:buffer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tracehound } from '../src/index.js'

// Mock agent factory
function createMockAgent(result: InterceptResult): IAgent {
  return {
    intercept: vi.fn().mockReturnValue(result),
    stats: { intercepted: 0, quarantined: 0, rateLimited: 0, errors: 0 },
  } as unknown as IAgent
}

// Mock Express objects
function createMockReq(overrides: Partial<Request & { rawBody: Buffer }> = {}): Request {
  return {
    ip: '127.0.0.1',
    method: 'GET',
    path: '/test',
    query: {},
    body: {},
    get: vi.fn((header: string) => {
      if (header === 'user-agent') return 'test-agent'
      if (header === 'content-type') return 'application/json'
      return ''
    }),
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as Request
}

function createMockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  }
  return res as unknown as Response
}

describe('tracehound middleware', () => {
  let next: NextFunction

  beforeEach(() => {
    next = vi.fn()
  })

  it('should call next() for clean result', () => {
    const agent = createMockAgent({ status: 'clean' })
    const middleware = tracehound({ agent })

    middleware(createMockReq(), createMockRes(), next)

    expect(next).toHaveBeenCalled()
    expect(agent.intercept).toHaveBeenCalled()
  })

  it('should call next() for ignored result', () => {
    const agent = createMockAgent({ status: 'ignored', signature: 'test-sig' })
    const middleware = tracehound({ agent })

    middleware(createMockReq(), createMockRes(), next)

    expect(next).toHaveBeenCalled()
  })

  it('should return 429 for rate_limited result', () => {
    const agent = createMockAgent({ status: 'rate_limited', retryAfter: 5000 })
    const middleware = tracehound({ agent })
    const res = createMockRes()

    middleware(createMockReq(), res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(429)
    expect(res.set).toHaveBeenCalledWith('Retry-After', '5')
  })

  it('should return 413 for payload_too_large result', () => {
    const agent = createMockAgent({
      status: 'payload_too_large',
      limit: 1000000,
    })
    const middleware = tracehound({ agent })
    const res = createMockRes()

    middleware(createMockReq(), res, next)

    expect(res.status).toHaveBeenCalledWith(413)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ limit: 1000000 }))
  })

  it('should return 413 without destroying socket when result is payload_too_large', () => {
    const destroy = vi.fn()
    const agent = createMockAgent({ status: 'payload_too_large', limit: 2048 })
    const middleware = tracehound({ agent })
    const req = createMockReq({
      socket: {
        remoteAddress: '127.0.0.1',
        destroy,
      } as unknown as Request['socket'],
    })
    const res = createMockRes()

    middleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(413)
    expect(destroy).not.toHaveBeenCalled()
  })

  it('should NOT return signature by default for quarantined result', () => {
    const agent = createMockAgent({
      status: 'quarantined',
      handle: { signature: 'test-sig' } as unknown as RuntimeEvidenceHandle,
    })
    const middleware = tracehound({ agent })
    const res = createMockRes()

    middleware(createMockReq(), res, next)

    expect(res.status).toHaveBeenCalledWith(403)
    const jsonBody = vi.mocked(res.json).mock.calls[0][0]
    expect(jsonBody.signature).toBeUndefined()
    expect(jsonBody.error).toBe('Forbidden')
    expect(res.set).not.toHaveBeenCalledWith('x-tracehound-trace-id', expect.any(String))
  })

  it('should return signature when emitSignatureInResponse is true', () => {
    const agent = createMockAgent({
      status: 'quarantined',
      handle: { signature: 'test-sig' } as unknown as RuntimeEvidenceHandle,
    })
    const middleware = tracehound({ agent, emitSignatureInResponse: true })
    const res = createMockRes()

    middleware(createMockReq(), res, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ signature: 'test-sig' }))
  })

  it('should emit opaque x-tracehound-trace-id header when enabled for quarantined result', () => {
    const signature = 'trace-123'
    const agent = createMockAgent({
      status: 'quarantined',
      handle: { signature } as unknown as RuntimeEvidenceHandle,
    })
    const middleware = tracehound({ agent, emitTraceIdHeader: true })
    const res = createMockRes()

    middleware(createMockReq(), res, next)

    expect(res.status).toHaveBeenCalledWith(403)

    const traceIdCall = vi.mocked(res.set).mock.calls.find(
      ([name]) => name === 'x-tracehound-trace-id',
    )
    expect(traceIdCall).toBeDefined()

    const [, traceId] = traceIdCall as [string, string]
    expect(traceId).toEqual(expect.any(String))
    expect(traceId).not.toBe(signature)
  })
  it('should fail open and call next when result is error', () => {
    const agent = createMockAgent({
      status: 'error',
      error: {
        state: 'agent',
        code: 'TEST',
        message: 'fail',
        recoverable: false,
      },
    })
    const middleware = tracehound({ agent })
    const res = createMockRes()

    middleware(createMockReq(), res, next)

    expect(next).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
    expect(res.json).not.toHaveBeenCalled()
  })

  describe('default handlers', () => {
    it('should use defaultExtractScent to pull IP and payload', () => {
      const agent = createMockAgent({ status: 'clean' })
      const middleware = tracehound({ agent })
      const req = createMockReq({
        ip: '10.0.0.1',
        method: 'POST',
        path: '/api/data',
        query: { key: 'val' },
        body: { foo: 'bar' },
      })

      middleware(req, createMockRes(), next)

      expect(agent.intercept).toHaveBeenCalledWith(
        expect.objectContaining({
          source: expect.objectContaining({
            ip: '10.0.0.1',
            userAgent: 'test-agent',
          }),
          payload: expect.objectContaining({
            method: 'POST',
            path: '/api/data',
            query: { key: 'val' },
            body: { foo: 'bar' },
          }),
        }),
      )
    })

    it('should handle cyclical structures in body/query without crashing', () => {
      const agent = createMockAgent({ status: 'clean' })
      const middleware = tracehound({ agent })

      const circular: Record<string, unknown> = { a: 1 }
      circular['self'] = circular

      const req = createMockReq({
        body: circular,
        query: { circ: circular } as unknown as Request['query'],
      })

      // Should not throw
      expect(() => middleware(req, createMockRes(), next)).not.toThrow()
      expect(agent.intercept).toHaveBeenCalled()

      const scent = vi.mocked(agent.intercept).mock.calls[0][0]
      const scentPayload = scent.payload as Record<string, unknown>
      expect(scentPayload['body']).toBeUndefined() // safeClone returns undefined on circular
      expect((scentPayload['query'] as Record<string, unknown> | undefined)?.['circ']).toBeUndefined()
    })

    it('captures rawBody bytes into ingressBytes when available', () => {
      const agent = createMockAgent({ status: 'clean' })
      const middleware = tracehound({ agent })

      middleware(
        createMockReq({
          rawBody: Buffer.from('{"raw":true}', 'utf8') as unknown as Request['body'],
          body: { ignored: 'for hashing preference' },
        }),
        createMockRes(),
        next,
      )

      const scent = vi.mocked(agent.intercept).mock.calls[0][0]
      expect(scent.ingressBytes).toBeInstanceOf(Uint8Array)
      expect(Buffer.from(scent.ingressBytes! as Uint8Array).toString('utf8')).toBe('{"raw":true}')
    })

    it('does not populate ingressBytes from string body when rawBody is absent', () => {
      // ingressBytes is only populated from rawBody to preserve signature determinism.
      // Falling back to req.body would produce different signatures across middleware configs.
      const agent = createMockAgent({ status: 'clean' })
      const middleware = tracehound({ agent })

      middleware(
        createMockReq({
          body: 'plain-text-body' as unknown as Request['body'],
        }),
        createMockRes(),
        next,
      )

      const scent = vi.mocked(agent.intercept).mock.calls[0][0]
      expect(scent.ingressBytes).toBeUndefined()
    })

    it('does not populate ingressBytes from Uint8Array body when rawBody is absent', () => {
      const agent = createMockAgent({ status: 'clean' })
      const middleware = tracehound({ agent })

      middleware(
        createMockReq({
          body: new Uint8Array([1, 2, 3]) as unknown as Request['body'],
        }),
        createMockRes(),
        next,
      )

      const scent = vi.mocked(agent.intercept).mock.calls[0][0]
      expect(scent.ingressBytes).toBeUndefined()
    })

    it('does not populate ingressBytes from ArrayBuffer body when rawBody is absent', () => {
      const agent = createMockAgent({ status: 'clean' })
      const middleware = tracehound({ agent })
      const bytes = new Uint8Array([4, 5, 6])

      middleware(
        createMockReq({
          body: bytes.buffer.slice(0) as unknown as Request['body'],
        }),
        createMockRes(),
        next,
      )

      const scent = vi.mocked(agent.intercept).mock.calls[0][0]
      expect(scent.ingressBytes).toBeUndefined()
    })

    it('populates source.tls when TLS socket methods are available', () => {
      const agent = createMockAgent({ status: 'clean' })
      const middleware = tracehound({ agent })
      const req = createMockReq({
        socket: {
          remoteAddress: '127.0.0.1',
          getCipher: () => ({ name: 'TLS_AES_256_GCM_SHA384' }),
          getProtocol: () => 'TLSv1.3',
          alpnProtocol: 'h2',
        } as unknown as Request['socket'],
      })

      middleware(req, createMockRes(), next)

      const scent = vi.mocked(agent.intercept).mock.calls[0][0]
      expect(scent.source.tls).toEqual({
        cipherSuite: 'TLS_AES_256_GCM_SHA384',
        version: 'TLSv1.3',
        alpn: 'h2',
      })
    })

    it('omits alpn from source.tls when alpnProtocol is false', () => {
      const agent = createMockAgent({ status: 'clean' })
      const middleware = tracehound({ agent })
      const req = createMockReq({
        socket: {
          remoteAddress: '127.0.0.1',
          getCipher: () => ({ name: 'TLS_AES_256_GCM_SHA384' }),
          getProtocol: () => 'TLSv1.3',
          alpnProtocol: false,
        } as unknown as Request['socket'],
      })

      middleware(req, createMockRes(), next)

      const scent = vi.mocked(agent.intercept).mock.calls[0][0]
      expect(scent.source.tls?.cipherSuite).toBe('TLS_AES_256_GCM_SHA384')
      expect(scent.source.tls?.alpn).toBeUndefined()
    })

    it('falls back to "unknown" version when getProtocol returns null', () => {
      const agent = createMockAgent({ status: 'clean' })
      const middleware = tracehound({ agent })
      const req = createMockReq({
        socket: {
          remoteAddress: '127.0.0.1',
          getCipher: () => ({ name: 'TLS_AES_256_GCM_SHA384' }),
          getProtocol: () => null,
          alpnProtocol: false,
        } as unknown as Request['socket'],
      })

      middleware(req, createMockRes(), next)

      const scent = vi.mocked(agent.intercept).mock.calls[0][0]
      expect(scent.source.tls?.version).toBe('unknown')
    })

    it('should use defaultOnIntercept when result is blocked', () => {
      const agent = createMockAgent({
        status: 'rate_limited',
        retryAfter: 2000,
      })
      const middleware = tracehound({ agent })
      const res = createMockRes()

      middleware(createMockReq(), res, next)

      expect(res.status).toHaveBeenCalledWith(429)
      expect(res.set).toHaveBeenCalledWith('Retry-After', '2')
    })

    it('fails open for unexpected intercept statuses by continuing the middleware chain', () => {
      const agent = createMockAgent({
        status: 'unexpected',
      } as unknown as InterceptResult)
      const middleware = tracehound({ agent })
      const res = createMockRes()

      middleware(createMockReq(), res, next)

      expect(res.status).not.toHaveBeenCalled()
      expect(next).toHaveBeenCalled()
    })
  })

  it('should use custom extractScent function', () => {
    const agent = createMockAgent({ status: 'clean' })
    const customScent = {
      id: 'test-id',
      timestamp: Date.now(),
      source: { ip: 'custom' },
      payload: { custom: true },
    }
    const extractScent = vi.fn().mockReturnValue(customScent)

    const middleware = tracehound({ agent, extractScent })
    middleware(createMockReq(), createMockRes(), next)

    expect(extractScent).toHaveBeenCalled()
    expect(agent.intercept).toHaveBeenCalledWith(customScent)
  })

  it('should use custom onIntercept handler', () => {
    const agent = createMockAgent({ status: 'rate_limited', retryAfter: 1000 })
    const onIntercept = vi.fn()

    const middleware = tracehound({ agent, onIntercept })
    const req = createMockReq()
    const res = createMockRes()

    middleware(req, res, next)

    expect(onIntercept).toHaveBeenCalledWith({ status: 'rate_limited', retryAfter: 1000 }, req, res)
    expect(next).toHaveBeenCalled()
  })

  it('should preserve custom error handling when onIntercept sends a response', () => {
    const agent = createMockAgent({
      status: 'error',
      error: {
        state: 'agent',
        code: 'TEST',
        message: 'fail',
        recoverable: false,
      },
    })
    const onIntercept = vi.fn((_, __, res: Response) => {
      ;(res as unknown as { headersSent: boolean }).headersSent = true
      res.status(500).json({ error: 'custom failure' })
    })
    const middleware = tracehound({ agent, onIntercept })
    const res = createMockRes()
    ;(res as unknown as { headersSent: boolean }).headersSent = false

    middleware(createMockReq(), res, next)

    expect(onIntercept).toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'custom failure' })
    expect(next).not.toHaveBeenCalled()
  })

  it('should propagate error when custom onIntercept throws after headers are sent', () => {
    const expected = new Error('custom intercept failed')
    const agent = createMockAgent({ status: 'rate_limited', retryAfter: 1000 })
    const onIntercept = vi.fn((_, __, res: Response) => {
      ;(res as unknown as { headersSent: boolean }).headersSent = true
      throw expected
    })

    const middleware = tracehound({ agent, onIntercept })
    const req = createMockReq()
    const res = createMockRes()
    ;(res as unknown as { headersSent: boolean }).headersSent = false

    middleware(req, res, next)

    expect(onIntercept).toHaveBeenCalled()
    expect(next).toHaveBeenCalledWith(expected)
  })

  it('should fail open and call next when intercept throws', () => {
    const agent = {
      intercept: vi.fn(() => {
        throw new Error('intercept failed')
      }),
      stats: { intercepted: 0, quarantined: 0, rateLimited: 0, errors: 0 },
    } as unknown as IAgent
    const middleware = tracehound({ agent })
    const res = createMockRes()

    middleware(createMockReq(), res, next)

    expect(next).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
  })
})
