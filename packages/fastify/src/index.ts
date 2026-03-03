/**
 * @tracehound/fastify
 *
 * Fastify plugin for Tracehound security buffer.
 */

import {
  generateSecureId,
  recordTraceInspectionEntry,
  type IAgent,
  type InterceptResult,
  type Scent,
} from '@tracehound/core'
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify'

/**
 * Plugin configuration options.
 */
export interface TracehoundPluginOptions {
  /**
   * Tracehound Agent instance.
   * Required - must be created via createAgent() from @tracehound/core.
   */
  agent: IAgent

  /**
   * If true, includes the Tracehound `signature` in the HTTP 403 Forbidden body
   * for quarantined requests. This is false by default to prevent correlation attacks.
   */
  emitSignatureInResponse?: boolean

  /**
   * If true, emits x-tracehound-trace-id for quarantined responses.
   * Disabled by default for privacy-sensitive environments.
   */
  emitTraceIdHeader?: boolean

  /**
   * Custom scent extraction function.
   * Default extracts IP, path, method, and headers safely.
   */
  extractScent?: (req: FastifyRequest) => Scent

  /**
   * Custom response handler for intercepted requests.
   * Default sends appropriate HTTP status codes.
   */
  onIntercept?: (result: InterceptResult, req: FastifyRequest, reply: FastifyReply) => void
}

/**
 * Defensive clone for safely copying deeply nested or cyclical external payloads
 * without crashing the process.
 */
function safeClone(obj: any): any {
  if (obj === undefined) return undefined
  try {
    return JSON.parse(JSON.stringify(obj))
  } catch {
    return undefined // Unsafe to clone or cyclical, omit silently
  }
}

/**
 * Default scent extraction from Fastify request.
 */
function defaultExtractScent(req: FastifyRequest): Scent {
  const ip = req.ip || 'unknown'

  return {
    id: generateSecureId(),
    timestamp: Date.now(),
    source: ip,
    payload: {
      method: req.method,
      path: req.url,
      query: safeClone(req.query) ?? {},
      headers: {
        'user-agent': req.headers['user-agent'] || '',
        'content-type': req.headers['content-type'] || '',
      },
      body: safeClone(req.body),
    },
  }
}

/**
 * Default intercept result handler.
 */
function defaultOnIntercept(
  result: InterceptResult,
  req: FastifyRequest,
  reply: FastifyReply,
  options?: Pick<TracehoundPluginOptions, 'emitSignatureInResponse' | 'emitTraceIdHeader'>,
): void {
  switch (result.status) {
    case 'rate_limited':
      reply
        .header('Retry-After', String(Math.ceil(result.retryAfter / 1000)))
        .status(429)
        .send({
          error: 'Too Many Requests',
          retryAfter: result.retryAfter,
        })
      break

    case 'payload_too_large':
      reply.status(413).send({
        error: 'Payload Too Large',
        limit: result.limit,
      })
      break

    case 'quarantined':
      if (options?.emitTraceIdHeader) {
        const traceId = generateSecureId()
        const source = req.ip || 'unknown'

        reply.header('x-tracehound-trace-id', traceId)
        recordTraceInspectionEntry({
          traceId,
          signature: result.handle.signature,
          severity: result.handle.severity,
          size: result.handle.size,
          captured: result.handle.captured,
          source,
        })
      }

      reply.status(403).send({
        error: 'Forbidden',
        ...(options?.emitSignatureInResponse ? { signature: result.handle.signature } : {}),
      })
      break

    case 'error':
      reply.status(500).send({
        error: 'Internal Server Error',
      })
      break

    default:
      // clean, ignored - should not reach here
      break
  }
}

/**
 * Tracehound Fastify plugin.
 *
 * @example
 * ```ts
 * import fastify from 'fastify'
 * import { tracehoundPlugin } from '@tracehound/fastify'
 * import { createTracehound } from '@tracehound/core'
 *
 * const app = fastify()
 * const th = createTracehound({ }) // options here
 *
 * app.register(tracehoundPlugin, { agent: th.agent })
 * ```
 */
export const tracehoundPlugin: FastifyPluginCallback<TracehoundPluginOptions> = (
  fastify,
  options,
  done,
) => {
  const { agent, extractScent = defaultExtractScent, onIntercept } = options

  fastify.addHook('onRequest', (req, reply, hookDone) => {
    const scent = extractScent(req)
    const result = agent.intercept(scent)

    if (result.status === 'clean' || result.status === 'ignored') {
      hookDone()
      return
    }

    if (onIntercept) {
      onIntercept(result, req, reply)
    } else {
      const interceptOptions: Pick<
        TracehoundPluginOptions,
        'emitSignatureInResponse' | 'emitTraceIdHeader'
      > = {}

      if (options.emitSignatureInResponse !== undefined) {
        interceptOptions.emitSignatureInResponse = options.emitSignatureInResponse
      }
      if (options.emitTraceIdHeader !== undefined) {
        interceptOptions.emitTraceIdHeader = options.emitTraceIdHeader
      }

      defaultOnIntercept(result, req, reply, interceptOptions)
    }
    // Don't call hookDone() - response is already sent
  })

  done()
}

/**
 * Create Tracehound plugin (alias).
 */
export const createPlugin = tracehoundPlugin

// Default export for Fastify auto-loading
export default tracehoundPlugin

// Re-export types for convenience
export type { InterceptResult, Scent } from '@tracehound/core'

