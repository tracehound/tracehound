/**
 * @tracehound/fastify
 *
 * Fastify plugin for Tracehound security buffer.
 */

import { generateSecureId, type IAgent, type InterceptResult, type Scent } from '@tracehound/core'
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
   * Custom scent extraction function.
   * Default extracts IP, path, method, and headers.
   */
  extractScent?: (req: FastifyRequest) => Scent

  /**
   * Custom response handler for intercepted requests.
   * Default sends appropriate HTTP status codes.
   */
  onIntercept?: (result: InterceptResult, req: FastifyRequest, reply: FastifyReply) => void
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
      query: JSON.parse(JSON.stringify(req.query)),
      headers: {
        'user-agent': req.headers['user-agent'] || '',
        'content-type': req.headers['content-type'] || '',
      },
      body: req.body ? JSON.parse(JSON.stringify(req.body)) : undefined,
    },
  }
}

/**
 * Default intercept result handler.
 */
function defaultOnIntercept(
  result: InterceptResult,
  _req: FastifyRequest,
  reply: FastifyReply
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
      reply.status(403).send({
        error: 'Forbidden',
        signature: result.handle.signature,
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
 * import { createAgent } from '@tracehound/core'
 *
 * const app = fastify()
 * const agent = createAgent({ ... })
 *
 * app.register(tracehoundPlugin, { agent })
 * ```
 */
export const tracehoundPlugin: FastifyPluginCallback<TracehoundPluginOptions> = (
  fastify,
  options,
  done
) => {
  const { agent, extractScent = defaultExtractScent, onIntercept = defaultOnIntercept } = options

  fastify.addHook('onRequest', (req, reply, hookDone) => {
    const scent = extractScent(req)
    const result = agent.intercept(scent)

    if (result.status === 'clean' || result.status === 'ignored') {
      hookDone()
      return
    }

    onIntercept(result, req, reply)
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
