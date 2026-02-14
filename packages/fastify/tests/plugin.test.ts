/**
 * Fastify plugin tests.
 */

import type { IAgent, InterceptResult } from '@tracehound/core'
import type { FastifyReply, FastifyRequest } from 'fastify'
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
function createMockReq(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
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
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
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

    tracehoundPlugin(fastify as any, { agent }, done)

    expect(fastify.addHook).toHaveBeenCalledWith('onRequest', expect.any(Function))
    expect(done).toHaveBeenCalled()
  })

  it('should pass through for clean result', async () => {
    const agent = createMockAgent({ status: 'clean' })
    const fastify = createMockFastify()

    tracehoundPlugin(fastify as any, { agent }, () => {})

    const req = createMockReq()
    const reply = createMockReply()

    await fastify.triggerHook('onRequest', req, reply)

    expect(agent.intercept).toHaveBeenCalled()
    expect(reply.status).not.toHaveBeenCalled()
  })

  it('should return 429 for rate_limited', async () => {
    const agent = createMockAgent({ status: 'rate_limited', retryAfter: 5000 })
    const fastify = createMockFastify()

    tracehoundPlugin(fastify as any, { agent }, () => {})

    const req = createMockReq()
    const reply = createMockReply()

    // Get the hook handler directly
    const hookHandler = (fastify.addHook as any).mock.calls[0][1]
    hookHandler(req, reply, () => {})

    expect(reply.status).toHaveBeenCalledWith(429)
    expect(reply.header).toHaveBeenCalledWith('Retry-After', '5')
  })

  it('should return 403 for quarantined', async () => {
    const agent = createMockAgent({
      status: 'quarantined',
      handle: { signature: 'test-sig' } as any,
    })
    const fastify = createMockFastify()

    tracehoundPlugin(fastify as any, { agent }, () => {})

    const req = createMockReq()
    const reply = createMockReply()

    const hookHandler = (fastify.addHook as any).mock.calls[0][1]
    hookHandler(req, reply, () => {})

    expect(reply.status).toHaveBeenCalledWith(403)
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ signature: 'test-sig' }))
  })

  it('should return 413 for payload_too_large', async () => {
    const agent = createMockAgent({ status: 'payload_too_large', limit: 1000 })
    const fastify = createMockFastify()

    tracehoundPlugin(fastify as any, { agent }, () => {})

    const req = createMockReq()
    const reply = createMockReply()

    const hookHandler = (fastify.addHook as any).mock.calls[0][1]
    hookHandler(req, reply, () => {})

    expect(reply.status).toHaveBeenCalledWith(413)
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ limit: 1000 }))
  })

  it('should return 500 for error result', async () => {
    const agent = createMockAgent({
      status: 'error',
      error: { state: 'agent', code: 'ERR', message: 'fail', recoverable: false },
    })
    const fastify = createMockFastify()

    tracehoundPlugin(fastify as any, { agent }, () => {})

    const req = createMockReq()
    const reply = createMockReply()

    const hookHandler = (fastify.addHook as any).mock.calls[0][1]
    hookHandler(req, reply, () => {})

    expect(reply.status).toHaveBeenCalledWith(500)
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Internal Server Error' }),
    )
  })

  it('should pass through for ignored result', async () => {
    const agent = createMockAgent({ status: 'ignored', signature: 'sig' })
    const fastify = createMockFastify()
    const next = vi.fn()

    tracehoundPlugin(fastify as any, { agent }, () => {})

    const req = createMockReq()
    const reply = createMockReply()

    const hookHandler = (fastify.addHook as any).mock.calls[0][1]
    hookHandler(req, reply, next)

    expect(next).toHaveBeenCalled()
    expect(reply.status).not.toHaveBeenCalled()
  })

  describe('default handlers', () => {
    it('should use defaultExtractScent to pull IP and payload', () => {
      const agent = createMockAgent({ status: 'clean' })
      const fastify = createMockFastify()

      tracehoundPlugin(fastify as any, { agent }, () => {})

      const req = createMockReq({
        ip: '192.168.1.1',
        method: 'PUT',
        url: '/v1/resource',
        query: { active: 'true' },
        body: { data: 123 },
      })
      const reply = createMockReply()
      const next = vi.fn()

      const hookHandler = (fastify.addHook as any).mock.calls[0][1]
      hookHandler(req, reply, next)

      expect(agent.intercept).toHaveBeenCalledWith(
        expect.objectContaining({
          source: '192.168.1.1',
          payload: expect.objectContaining({
            method: 'PUT',
            path: '/v1/resource',
            query: { active: 'true' },
            body: { data: 123 },
          }),
        }),
      )
    })
  })

  it('should use custom extractScent', () => {
    const agent = createMockAgent({ status: 'clean' })
    const customScent = {
      id: 'test-id',
      timestamp: Date.now(),
      source: 'custom',
      payload: { custom: true },
    }
    const extractScent = vi.fn().mockReturnValue(customScent)

    const fastify = createMockFastify()
    tracehoundPlugin(fastify as any, { agent, extractScent }, () => {})

    const req = createMockReq()
    const reply = createMockReply()

    const hookHandler = (fastify.addHook as any).mock.calls[0][1]
    hookHandler(req, reply, () => {})

    expect(extractScent).toHaveBeenCalled()
    expect(agent.intercept).toHaveBeenCalledWith(customScent)
  })
})
