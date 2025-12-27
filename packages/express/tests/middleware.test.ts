/**
 * Express middleware tests.
 */

import type { IAgent, InterceptResult } from '@tracehound/core'
import type { NextFunction, Request, Response } from 'express'
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
function createMockReq(overrides: Partial<Request> = {}): Request {
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
    const agent = createMockAgent({ status: 'payload_too_large', limit: 1000000 })
    const middleware = tracehound({ agent })
    const res = createMockRes()

    middleware(createMockReq(), res, next)

    expect(res.status).toHaveBeenCalledWith(413)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ limit: 1000000 }))
  })

  it('should return 403 for quarantined result', () => {
    const agent = createMockAgent({
      status: 'quarantined',
      handle: { signature: 'test-sig' } as any,
    })
    const middleware = tracehound({ agent })
    const res = createMockRes()

    middleware(createMockReq(), res, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ signature: 'test-sig' }))
  })

  it('should use custom extractScent function', () => {
    const agent = createMockAgent({ status: 'clean' })
    const customScent = {
      id: 'test-id',
      timestamp: Date.now(),
      source: 'custom',
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
  })
})
