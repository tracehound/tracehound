/**
 * Fastify plugin tests.
 */

import type { IAgent, InterceptResult, RuntimeEvidenceHandle } from '@tracehound/core'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { tracehoundPlugin } from '../src/index.js'

// Mock agent factory
function createMockAgent(result: InterceptResult): IAgent {
  return {
    intercept: vi.fn().mockReturnValue(result),
    stats: { intercepted: 0, quarantined: 0, rateLimited: 0, errors: 0 },
  } as unknown as IAgent
}

// Mock Fastify objects
function createMockReq(
  overrides: Partial<FastifyRequest> & { rawBody?: unknown } = {},
): FastifyRequest {
  return {
    ip: '127.0.0.1',
    method: 'GET',
    url: '/test',
    query: {},
    body: {},
    headers: {
      'user-agent': 'test-agent',
      'content-type': 'application/json',
    },
    ...overrides,
  } as unknown as FastifyRequest
}

function createMockReply(): FastifyReply {
  const reply = {
    sent: false,
    status: vi.fn().mockReturnThis(),
    send: vi.fn(function (this: { sent: boolean }) {
      this.sent = true
      return this
    }),
    header: vi.fn().mockReturnThis(),
  }
  return reply as unknown as FastifyReply
}

// Mock Fastify instance
function createMockFastify() {
  const hooks: Record<string, Function[]> = {}

  return {
    addHook: vi.fn((name: string, handler: Function) => {
      if (!hooks[name]) hooks[name] = []
      hooks[name].push(handler)
    }),
    triggerHook: async (name: string, req: FastifyRequest, reply: FastifyReply) => {
      for (const handler of hooks[name] || []) {
        await new Promise<void>((resolve) => handler(req, reply, resolve))
      }
    },
  }
}

describe('tracehoundPlugin', () => {
  it('should register onRequest hook', () => {
    const agent = createMockAgent({ status: 'clean' })
    const fastify = createMockFastify()
    const done = vi.fn()

    tracehoundPlugin(fastify as unknown as FastifyInstance, { agent }, done)

    expect(fastify.addHook).toHaveBeenCalledWith('onRequest', expect.any(Function))
    expect(done).toHaveBeenCalled()
  })

  it('should pass through for clean result', async () => {
    const agent = createMockAgent({ status: 'clean' })
    const fastify = createMockFastify()

    tracehoundPlugin(fastify as unknown as FastifyInstance, { agent }, () => {})

    const req = createMockReq()
    const reply = createMockReply()

    await fastify.triggerHook('onRequest', req, reply)

    expect(agent.intercept).toHaveBeenCalled()
    expect(reply.status).not.toHaveBeenCalled()
  })

  it('should return 429 for rate_limited', async () => {
    const agent = createMockAgent({ status: 'rate_limited', retryAfter: 5000 })
    const fastify = createMockFastify()

    tracehoundPlugin(fastify as unknown as FastifyInstance, { agent }, () => {})

    const req = createMockReq()
    const reply = createMockReply()

    // Get the hook handler directly
    const hookHandler = fastify.addHook.mock.calls[0][1]
    hookHandler(req, reply, () => {})

    expect(reply.status).toHaveBeenCalledWith(429)
    expect(reply.header).toHaveBeenCalledWith('Retry-After', '5')
  })

  it('should NOT return signature by default for quarantined', async () => {
    const agent = createMockAgent({
      status: 'quarantined',
      handle: { signature: 'test-sig' } as unknown as RuntimeEvidenceHandle,
    })
    const fastify = createMockFastify()

    tracehoundPlugin(fastify as unknown as FastifyInstance, { agent }, () => {})

    const req = createMockReq()
    const reply = createMockReply()

    const hookHandler = fastify.addHook.mock.calls[0][1]
    hookHandler(req, reply, () => {})

    expect(reply.status).toHaveBeenCalledWith(403)
    const sentBody = vi.mocked(reply.send).mock.calls[0][0] as Record<string, unknown>
    expect(sentBody.signature).toBeUndefined()
    expect(sentBody.error).toBe('Forbidden')
    expect(reply.header).not.toHaveBeenCalledWith('x-tracehound-trace-id', expect.any(String))
  })

  it('should return signature when emitSignatureInResponse is true', async () => {
    const agent = createMockAgent({
      status: 'quarantined',
      handle: { signature: 'test-sig' } as unknown as RuntimeEvidenceHandle,
    })
    const fastify = createMockFastify()

    tracehoundPlugin(
      fastify as unknown as FastifyInstance,
      { agent, emitSignatureInResponse: true },
      () => {},
    )

    const req = createMockReq()
    const reply = createMockReply()

    const hookHandler = fastify.addHook.mock.calls[0][1]
    hookHandler(req, reply, () => {})

    expect(reply.status).toHaveBeenCalledWith(403)
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ signature: 'test-sig' }))
  })

  it('should emit opaque x-tracehound-trace-id header when enabled for quarantined', async () => {
    const signature = 'trace-123'
    const agent = createMockAgent({
      status: 'quarantined',
      handle: { signature } as unknown as RuntimeEvidenceHandle,
    })
    const fastify = createMockFastify()

    tracehoundPlugin(
      fastify as unknown as FastifyInstance,
      { agent, emitTraceIdHeader: true },
      () => {},
    )

    const req = createMockReq()
    const reply = createMockReply()

    const hookHandler = fastify.addHook.mock.calls[0][1]
    hookHandler(req, reply, () => {})

    expect(reply.status).toHaveBeenCalledWith(403)

    const traceIdCall = vi
      .mocked(reply.header)
      .mock.calls.find(([name]) => name === 'x-tracehound-trace-id')
    expect(traceIdCall).toBeDefined()

    const [, traceId] = traceIdCall as [string, string]
    expect(traceId).toEqual(expect.any(String))
    expect(traceId).not.toBe(signature)
  })
  it('should return 413 for payload_too_large', async () => {
    const agent = createMockAgent({ status: 'payload_too_large', limit: 1000 })
    const fastify = createMockFastify()

    tracehoundPlugin(fastify as unknown as FastifyInstance, { agent }, () => {})

    const req = createMockReq()
    const reply = createMockReply()

    const hookHandler = fastify.addHook.mock.calls[0][1]
    hookHandler(req, reply, () => {})

    expect(reply.status).toHaveBeenCalledWith(413)
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ limit: 1000 }))
  })

  it('should return 413 without destroying socket when result is payload_too_large', () => {
    const destroy = vi.fn()
    const agent = createMockAgent({ status: 'payload_too_large', limit: 2048 })
    const fastify = createMockFastify()

    tracehoundPlugin(fastify as unknown as FastifyInstance, { agent }, () => {})

    const req = createMockReq({
      raw: {
        socket: {
          destroy,
        },
      } as unknown as FastifyRequest['raw'],
    })
    const reply = createMockReply()

    const hookHandler = fastify.addHook.mock.calls[0][1]
    hookHandler(req, reply, () => {})

    expect(reply.status).toHaveBeenCalledWith(413)
    expect(destroy).not.toHaveBeenCalled()
  })

  it('should fail open and call hookDone when result is error', async () => {
    const agent = createMockAgent({
      status: 'error',
      error: {
        state: 'agent',
        code: 'ERR',
        message: 'fail',
        recoverable: false,
      },
    })
    const fastify = createMockFastify()

    tracehoundPlugin(fastify as unknown as FastifyInstance, { agent }, () => {})

    const req = createMockReq()
    const reply = createMockReply()
    const next = vi.fn()

    const hookHandler = fastify.addHook.mock.calls[0][1]
    hookHandler(req, reply, next)

    expect(next).toHaveBeenCalled()
    expect(reply.status).not.toHaveBeenCalled()
    expect(reply.send).not.toHaveBeenCalled()
  })

  it('should pass through for ignored result', async () => {
    const agent = createMockAgent({ status: 'ignored', signature: 'sig' })
    const fastify = createMockFastify()
    const next = vi.fn()

    tracehoundPlugin(fastify as unknown as FastifyInstance, { agent }, () => {})

    const req = createMockReq()
    const reply = createMockReply()

    const hookHandler = fastify.addHook.mock.calls[0][1]
    hookHandler(req, reply, next)

    expect(next).toHaveBeenCalled()
    expect(reply.status).not.toHaveBeenCalled()
  })

  describe('default handlers', () => {
    it('should use defaultExtractScent to pull IP and payload', () => {
      const agent = createMockAgent({ status: 'clean' })
      const fastify = createMockFastify()

      tracehoundPlugin(fastify as unknown as FastifyInstance, { agent }, () => {})

      const req = createMockReq({
        ip: '192.168.1.1',
        method: 'PUT',
        url: '/v1/resource',
        query: { active: 'true' },
        body: { data: 123 },
      })
      const reply = createMockReply()
      const next = vi.fn()

      const hookHandler = fastify.addHook.mock.calls[0][1]
      hookHandler(req, reply, next)

      expect(agent.intercept).toHaveBeenCalledWith(
        expect.objectContaining({
          source: expect.objectContaining({
            ip: '192.168.1.1',
            userAgent: 'test-agent',
          }),
          payload: expect.objectContaining({
            method: 'PUT',
            path: '/v1/resource',
            query: { active: 'true' },
            body: { data: 123 },
          }),
        }),
      )
    })

    it('should handle cyclical structures in body/query without crashing', () => {
      const agent = createMockAgent({ status: 'clean' })
      const fastify = createMockFastify()

      tracehoundPlugin(fastify as unknown as FastifyInstance, { agent }, () => {})

      const circular: Record<string, unknown> = { a: 1 }
      circular['self'] = circular

      const req = createMockReq({
        body: circular,
        query: { circ: circular } as unknown as FastifyRequest['query'],
      })
      const reply = createMockReply()
      const next = vi.fn()

      const hookHandler = fastify.addHook.mock.calls[0][1]

      // Should not throw
      expect(() => hookHandler(req, reply, next)).not.toThrow()
      expect(agent.intercept).toHaveBeenCalled()

      const scent = vi.mocked(agent.intercept).mock.calls[0][0]
      const scentPayload = scent.payload as Record<string, unknown>
      expect(scentPayload['body']).toBeUndefined()
      expect(
        (scentPayload['query'] as Record<string, unknown> | undefined)?.['circ'],
      ).toBeUndefined()
    })

    it('captures rawBody bytes into ingressBytes when available', () => {
      const agent = createMockAgent({ status: 'clean' })
      const fastify = createMockFastify()

      tracehoundPlugin(fastify as unknown as FastifyInstance, { agent }, () => {})

      const req = createMockReq({
        rawBody: Buffer.from('{"raw":true}', 'utf8') as unknown as FastifyRequest['body'],
        body: { ignored: 'for hashing preference' },
      })
      const reply = createMockReply()
      const next = vi.fn()

      const hookHandler = fastify.addHook.mock.calls[0][1]
      hookHandler(req, reply, next)

      const scent = vi.mocked(agent.intercept).mock.calls[0][0]
      expect(scent.ingressBytes).toBeInstanceOf(Uint8Array)
      expect(Buffer.from(scent.ingressBytes! as Uint8Array).toString('utf8')).toBe('{"raw":true}')
    })

    it('captures rawBody string into ingressBytes', () => {
      const agent = createMockAgent({ status: 'clean' })
      const fastify = createMockFastify()

      tracehoundPlugin(fastify as unknown as FastifyInstance, { agent }, () => {})

      const req = createMockReq({
        rawBody: 'raw-text' as unknown as FastifyRequest['body'],
      })
      const reply = createMockReply()
      const next = vi.fn()

      const hookHandler = fastify.addHook.mock.calls[0][1]
      hookHandler(req, reply, next)

      const scent = vi.mocked(agent.intercept).mock.calls[0][0]
      expect(Buffer.from(scent.ingressBytes! as Uint8Array).toString('utf8')).toBe('raw-text')
    })

    it('captures rawBody Uint8Array into ingressBytes without mutation', () => {
      const agent = createMockAgent({ status: 'clean' })
      const fastify = createMockFastify()
      const raw = new Uint8Array([7, 8, 9])

      tracehoundPlugin(fastify as unknown as FastifyInstance, { agent }, () => {})

      const req = createMockReq({
        rawBody: raw as unknown as FastifyRequest['body'],
      })
      const reply = createMockReply()
      const next = vi.fn()

      const hookHandler = fastify.addHook.mock.calls[0][1]
      hookHandler(req, reply, next)

      const scent = vi.mocked(agent.intercept).mock.calls[0][0]
      expect(Array.from(scent.ingressBytes! as Uint8Array)).toEqual([7, 8, 9])
    })

    it('captures rawBody ArrayBuffer into ingressBytes', () => {
      const agent = createMockAgent({ status: 'clean' })
      const fastify = createMockFastify()
      const raw = new Uint8Array([10, 11, 12]).buffer

      tracehoundPlugin(fastify as unknown as FastifyInstance, { agent }, () => {})

      const req = createMockReq({
        rawBody: raw as unknown as FastifyRequest['body'],
      })
      const reply = createMockReply()
      const next = vi.fn()

      const hookHandler = fastify.addHook.mock.calls[0][1]
      hookHandler(req, reply, next)

      const scent = vi.mocked(agent.intercept).mock.calls[0][0]
      expect(Array.from(scent.ingressBytes! as Uint8Array)).toEqual([10, 11, 12])
    })

    it('does not populate ingressBytes from string body when rawBody is absent', () => {
      // ingressBytes is only populated from rawBody to preserve signature determinism.
      // Falling back to req.body would produce different signatures across middleware configs.
      const agent = createMockAgent({ status: 'clean' })
      const fastify = createMockFastify()

      tracehoundPlugin(fastify as unknown as FastifyInstance, { agent }, () => {})

      const req = createMockReq({
        body: 'plain-text-body' as unknown as FastifyRequest['body'],
      })
      const reply = createMockReply()
      const next = vi.fn()

      const hookHandler = fastify.addHook.mock.calls[0][1]
      hookHandler(req, reply, next)

      const scent = vi.mocked(agent.intercept).mock.calls[0][0]
      expect(scent.ingressBytes).toBeUndefined()
    })

    it('does not populate ingressBytes from Uint8Array body when rawBody is absent', () => {
      const agent = createMockAgent({ status: 'clean' })
      const fastify = createMockFastify()

      tracehoundPlugin(fastify as unknown as FastifyInstance, { agent }, () => {})

      const req = createMockReq({
        body: new Uint8Array([1, 2, 3]) as unknown as FastifyRequest['body'],
      })
      const reply = createMockReply()
      const next = vi.fn()

      const hookHandler = fastify.addHook.mock.calls[0][1]
      hookHandler(req, reply, next)

      const scent = vi.mocked(agent.intercept).mock.calls[0][0]
      expect(scent.ingressBytes).toBeUndefined()
    })

    it('does not populate ingressBytes from ArrayBuffer body when rawBody is absent', () => {
      const agent = createMockAgent({ status: 'clean' })
      const fastify = createMockFastify()
      const bytes = new Uint8Array([4, 5, 6])

      tracehoundPlugin(fastify as unknown as FastifyInstance, { agent }, () => {})

      const req = createMockReq({
        body: bytes.buffer.slice(0) as unknown as FastifyRequest['body'],
      })
      const reply = createMockReply()
      const next = vi.fn()

      const hookHandler = fastify.addHook.mock.calls[0][1]
      hookHandler(req, reply, next)

      const scent = vi.mocked(agent.intercept).mock.calls[0][0]
      expect(scent.ingressBytes).toBeUndefined()
    })

    it('populates source.tls when TLS socket methods are available', () => {
      const agent = createMockAgent({ status: 'clean' })
      const fastify = createMockFastify()

      tracehoundPlugin(fastify as unknown as FastifyInstance, { agent }, () => {})

      const req = createMockReq({
        socket: {
          getCipher: () => ({ name: 'TLS_AES_256_GCM_SHA384' }),
          getProtocol: () => 'TLSv1.3',
          alpnProtocol: 'h2',
        } as unknown as FastifyRequest['socket'],
      })
      const reply = createMockReply()
      const next = vi.fn()

      const hookHandler = fastify.addHook.mock.calls[0][1]
      hookHandler(req, reply, next)

      const scent = vi.mocked(agent.intercept).mock.calls[0][0]
      expect(scent.source.tls).toEqual({
        cipherSuite: 'TLS_AES_256_GCM_SHA384',
        version: 'TLSv1.3',
        alpn: 'h2',
      })
    })

    it('omits alpn from source.tls when alpnProtocol is false', () => {
      const agent = createMockAgent({ status: 'clean' })
      const fastify = createMockFastify()

      tracehoundPlugin(fastify as unknown as FastifyInstance, { agent }, () => {})

      const req = createMockReq({
        socket: {
          getCipher: () => ({ name: 'TLS_AES_256_GCM_SHA384' }),
          getProtocol: () => 'TLSv1.3',
          alpnProtocol: false,
        } as unknown as FastifyRequest['socket'],
      })
      const reply = createMockReply()
      const next = vi.fn()

      const hookHandler = fastify.addHook.mock.calls[0][1]
      hookHandler(req, reply, next)

      const scent = vi.mocked(agent.intercept).mock.calls[0][0]
      expect(scent.source.tls?.cipherSuite).toBe('TLS_AES_256_GCM_SHA384')
      expect(scent.source.tls?.alpn).toBeUndefined()
    })

    it('falls back to "unknown" version when getProtocol returns null', () => {
      const agent = createMockAgent({ status: 'clean' })
      const fastify = createMockFastify()

      tracehoundPlugin(fastify as unknown as FastifyInstance, { agent }, () => {})

      const req = createMockReq({
        socket: {
          getCipher: () => ({ name: 'TLS_AES_256_GCM_SHA384' }),
          getProtocol: () => null,
          alpnProtocol: false,
        } as unknown as FastifyRequest['socket'],
      })
      const reply = createMockReply()
      const next = vi.fn()

      const hookHandler = fastify.addHook.mock.calls[0][1]
      hookHandler(req, reply, next)

      const scent = vi.mocked(agent.intercept).mock.calls[0][0]
      expect(scent.source.tls?.version).toBe('unknown')
    })

    it('takes first user-agent when multiple are present and adds anomaly flag', () => {
      const agent = createMockAgent({ status: 'clean' })
      const fastify = createMockFastify()

      tracehoundPlugin(fastify as unknown as FastifyInstance, { agent }, () => {})

      const req = createMockReq({
        ip: '',
        headers: {
          'user-agent': ['ua-a', 'ua-b'],
          'content-type': 'application/json',
        } as unknown as FastifyRequest['headers'],
      })
      const reply = createMockReply()
      const next = vi.fn()

      const hookHandler = fastify.addHook.mock.calls[0][1]
      hookHandler(req, reply, next)

      const scent = vi.mocked(agent.intercept).mock.calls[0][0]
      // IP falls back to 'unknown' when blank
      expect(scent.source.ip).toBe('unknown')
      // source.userAgent uses first value only — prevents comma-split confusion downstream
      expect(scent.source.userAgent).toBe('ua-a')
      const headers = (scent.payload as Record<string, unknown>)['headers'] as Record<
        string,
        unknown
      >
      expect(headers['user-agent']).toBe('ua-a')
      // Forensic anomaly flag signals the non-standard duplicate header
      expect(headers['x-multiple-user-agents']).toBe('true')
    })

    it('should extract path without query string from url', () => {
      const agent = createMockAgent({ status: 'clean' })
      const fastify = createMockFastify()

      tracehoundPlugin(fastify as unknown as FastifyInstance, { agent }, () => {})

      const req = createMockReq({
        url: '/api/resource?foo=bar&baz=1',
      })
      const reply = createMockReply()
      const next = vi.fn()

      const hookHandler = fastify.addHook.mock.calls[0][1]
      hookHandler(req, reply, next)

      const scent = vi.mocked(agent.intercept).mock.calls[0][0]
      expect((scent.payload as Record<string, unknown>)['path']).toBe('/api/resource')
    })

    it('should use resolveSourceIp when provided', () => {
      const agent = createMockAgent({ status: 'clean' })
      const fastify = createMockFastify()

      tracehoundPlugin(
        fastify as unknown as FastifyInstance,
        { agent, resolveSourceIp: () => '10.10.10.10' },
        () => {},
      )

      const req = createMockReq({ ip: '1.2.3.4' })
      const reply = createMockReply()
      const next = vi.fn()

      const hookHandler = fastify.addHook.mock.calls[0][1]
      hookHandler(req, reply, next)

      const scent = vi.mocked(agent.intercept).mock.calls[0][0]
      expect(scent.source.ip).toBe('10.10.10.10')
    })

    it('should skip body clone when Content-Length exceeds maxPayloadSize', () => {
      const agent = createMockAgent({ status: 'clean' })
      const fastify = createMockFastify()

      tracehoundPlugin(
        fastify as unknown as FastifyInstance,
        { agent, maxPayloadSize: 100 },
        () => {},
      )

      const req = createMockReq({
        body: { data: 'some content' },
        headers: {
          'user-agent': 'test-agent',
          'content-type': 'application/json',
          'content-length': '200',
        } as unknown as FastifyRequest['headers'],
      })
      const reply = createMockReply()
      const next = vi.fn()

      const hookHandler = fastify.addHook.mock.calls[0][1]
      hookHandler(req, reply, next)

      const scent = vi.mocked(agent.intercept).mock.calls[0][0]
      expect((scent.payload as Record<string, unknown>)['body']).toBeUndefined()
    })

    it('should clone body when Content-Length is within maxPayloadSize', () => {
      const agent = createMockAgent({ status: 'clean' })
      const fastify = createMockFastify()

      tracehoundPlugin(
        fastify as unknown as FastifyInstance,
        { agent, maxPayloadSize: 1000 },
        () => {},
      )

      const req = createMockReq({
        body: { data: 'small' },
        headers: {
          'user-agent': 'test-agent',
          'content-type': 'application/json',
          'content-length': '50',
        } as unknown as FastifyRequest['headers'],
      })
      const reply = createMockReply()
      const next = vi.fn()

      const hookHandler = fastify.addHook.mock.calls[0][1]
      hookHandler(req, reply, next)

      const scent = vi.mocked(agent.intercept).mock.calls[0][0]
      expect((scent.payload as Record<string, unknown>)['body']).toEqual({ data: 'small' })
    })

    it('omits source.userAgent when user-agent header is absent', () => {
      const agent = createMockAgent({ status: 'clean' })
      const fastify = createMockFastify()

      tracehoundPlugin(fastify as unknown as FastifyInstance, { agent }, () => {})

      const req = createMockReq({
        headers: {
          'content-type': 'application/json',
        } as unknown as FastifyRequest['headers'],
      })
      const reply = createMockReply()
      const next = vi.fn()

      const hookHandler = fastify.addHook.mock.calls[0][1]
      hookHandler(req, reply, next)

      const scent = vi.mocked(agent.intercept).mock.calls[0][0]
      expect(scent.source.userAgent).toBeUndefined()
      expect((scent.payload as Record<string, unknown>)['headers']).toEqual(
        expect.objectContaining({ 'user-agent': '' }),
      )
    })
  })

  it('should use custom extractScent', () => {
    const agent = createMockAgent({ status: 'clean' })
    const customScent = {
      id: 'test-id',
      timestamp: Date.now(),
      source: { ip: 'custom' },
      payload: { custom: true },
    }
    const extractScent = vi.fn().mockReturnValue(customScent)

    const fastify = createMockFastify()
    tracehoundPlugin(fastify as unknown as FastifyInstance, { agent, extractScent }, () => {})

    const req = createMockReq()
    const reply = createMockReply()

    const hookHandler = fastify.addHook.mock.calls[0][1]
    hookHandler(req, reply, () => {})

    expect(extractScent).toHaveBeenCalled()
    expect(agent.intercept).toHaveBeenCalledWith(customScent)
  })

  it('uses injected clock for default scent timestamp', () => {
    const agent = createMockAgent({ status: 'clean' })
    const fastify = createMockFastify()

    tracehoundPlugin(fastify as unknown as FastifyInstance, { agent, _now: () => 654 }, () => {})

    const req = createMockReq()
    const reply = createMockReply()

    const hookHandler = fastify.addHook.mock.calls[0][1]
    hookHandler(req, reply, () => {})

    const scent = vi.mocked(agent.intercept).mock.calls[0][0]
    expect(scent.timestamp).toBe(654)
  })

  it('should use custom onIntercept handler and fail open when no reply is sent', () => {
    const agent = createMockAgent({ status: 'rate_limited', retryAfter: 1000 })
    const onIntercept = vi.fn()
    const fastify = createMockFastify()
    const next = vi.fn()

    tracehoundPlugin(fastify as unknown as FastifyInstance, { agent, onIntercept }, () => {})

    const req = createMockReq()
    const reply = createMockReply()

    const hookHandler = fastify.addHook.mock.calls[0][1]
    hookHandler(req, reply, next)

    expect(onIntercept).toHaveBeenCalledWith(
      { status: 'rate_limited', retryAfter: 1000 },
      req,
      reply,
    )
    expect(next).toHaveBeenCalled()
  })

  it('should preserve custom error handling when onIntercept sends a response', () => {
    const agent = createMockAgent({
      status: 'error',
      error: {
        state: 'agent',
        code: 'ERR',
        message: 'fail',
        recoverable: false,
      },
    })
    const onIntercept = vi.fn((_, __, reply: FastifyReply) => {
      reply.status(500).send({ error: 'custom failure' })
    })
    const fastify = createMockFastify()
    const next = vi.fn()

    tracehoundPlugin(fastify as unknown as FastifyInstance, { agent, onIntercept }, () => {})

    const req = createMockReq()
    const reply = createMockReply()

    const hookHandler = fastify.addHook.mock.calls[0][1]
    hookHandler(req, reply, next)

    expect(onIntercept).toHaveBeenCalled()
    expect(reply.status).toHaveBeenCalledWith(500)
    expect(reply.send).toHaveBeenCalledWith({ error: 'custom failure' })
    expect(next).not.toHaveBeenCalled()
  })

  it('should propagate error when custom onIntercept throws after reply is sent', () => {
    const expected = new Error('custom intercept failed')
    const agent = createMockAgent({ status: 'rate_limited', retryAfter: 1000 })
    const onIntercept = vi.fn((_, __, reply: FastifyReply) => {
      ;(reply as unknown as { sent: boolean }).sent = true
      throw expected
    })
    const fastify = createMockFastify()
    const next = vi.fn()

    tracehoundPlugin(fastify as unknown as FastifyInstance, { agent, onIntercept }, () => {})

    const req = createMockReq()
    const reply = createMockReply()
    ;(reply as unknown as { sent: boolean }).sent = false

    const hookHandler = fastify.addHook.mock.calls[0][1]
    hookHandler(req, reply, next)

    expect(onIntercept).toHaveBeenCalled()
    expect(next).toHaveBeenCalledWith(expected)
  })

  it('should propagate undefined error when custom onIntercept throws non-Error after reply is sent', () => {
    const agent = createMockAgent({ status: 'rate_limited', retryAfter: 1000 })
    const onIntercept = vi.fn((_, __, reply: FastifyReply) => {
      ;(reply as unknown as { sent: boolean }).sent = true
      throw 'non-error-throwable'
    })
    const fastify = createMockFastify()
    const next = vi.fn()

    tracehoundPlugin(fastify as unknown as FastifyInstance, { agent, onIntercept }, () => {})

    const req = createMockReq()
    const reply = createMockReply()
    ;(reply as unknown as { sent: boolean }).sent = false

    const hookHandler = fastify.addHook.mock.calls[0][1]
    hookHandler(req, reply, next)

    expect(onIntercept).toHaveBeenCalled()
    expect(next).toHaveBeenCalledWith(undefined)
  })

  it('should fail open and call hookDone when intercept throws', () => {
    const agent = {
      intercept: vi.fn(() => {
        throw new Error('intercept failed')
      }),
      stats: { intercepted: 0, quarantined: 0, rateLimited: 0, errors: 0 },
    } as unknown as IAgent
    const fastify = createMockFastify()
    const next = vi.fn()

    tracehoundPlugin(fastify as unknown as FastifyInstance, { agent }, () => {})

    const req = createMockReq()
    const reply = createMockReply()

    const hookHandler = fastify.addHook.mock.calls[0][1]
    hookHandler(req, reply, next)

    expect(next).toHaveBeenCalled()
    expect(reply.status).not.toHaveBeenCalled()
  })

  it('fails open for unexpected intercept statuses by calling hookDone', () => {
    const agent = createMockAgent({
      status: 'unexpected',
    } as unknown as InterceptResult)
    const fastify = createMockFastify()
    const next = vi.fn()

    tracehoundPlugin(fastify as unknown as FastifyInstance, { agent }, () => {})

    const req = createMockReq()
    const reply = createMockReply()

    const hookHandler = fastify.addHook.mock.calls[0][1]
    hookHandler(req, reply, next)

    expect(reply.status).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalled()
  })
})
