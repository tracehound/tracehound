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
  type JsonSerializable,
  type Scent,
  type ScentSource,
} from '@tracehound/core'
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify'
import { Buffer } from 'node:buffer'

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
   * Maximum payload size in bytes used to guard body clone operations.
   * Should match the agent's maxPayloadSize. When set and Content-Length
   * exceeds this value, body clone is skipped to prevent memory amplification
   * (JSON.stringify + JSON.parse on multi-MB bodies before agent rejection).
   * ingressBytes (rawBody) is still captured for signature computation.
   */
  maxPayloadSize?: number

  /**
   * Custom IP resolver. Override to control which IP is recorded in the scent source.
   *
   * SECURITY: req.ip in Fastify follows the trustProxy setting. If misconfigured
   * behind a CDN/LB, an attacker may spoof the IP via X-Forwarded-For to bypass
   * rate limiting. Provide this function to use a trusted source.
   *
   * @example
   * // Always use the direct connection IP, ignoring X-Forwarded-For:
   * resolveSourceIp: (req) => req.socket.remoteAddress ?? 'unknown'
   */
  resolveSourceIp?: (req: FastifyRequest) => string

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

  /**
   * Injectable clock returning current time in ms.
   * DEFAULT: Date.now.
   * @internal For deterministic testing only.
   */
  _now?: () => number
}

const textEncoder = new TextEncoder()

function defaultNow(): number {
  // eslint-disable-next-line no-restricted-syntax -- adapter bridge preserves fake-timer compatibility without expanding runtime state
  return Date.now()
}

/**
 * Defensive clone for safely copying deeply nested or cyclical external payloads
 * without crashing the process.
 */
function safeClone(value: unknown): JsonSerializable | undefined {
  if (value === undefined) return undefined
  try {
    return JSON.parse(JSON.stringify(value)) as JsonSerializable
  } catch {
    return undefined // Unsafe to clone or cyclical, omit silently
  }
}

/**
 * Returns true if Content-Length is present and exceeds maxPayloadSize.
 * Used as a best-effort pre-filter to avoid memory amplification from body
 * cloning before the agent's size enforcement runs.
 * Note: Content-Length can be absent (chunked) or incorrect; this is a guard,
 * not a security enforcement — the agent enforces the hard limit.
 */
function isBodyOversized(req: FastifyRequest, maxPayloadSize: number | undefined): boolean {
  if (maxPayloadSize === undefined) return false
  const raw = req.headers['content-length']
  if (raw === undefined) return false
  const values = Array.isArray(raw) ? raw : [raw]
  let maxContentLength: number | undefined
  for (const value of values) {
    if (typeof value !== 'string') continue
    const parsed = parseInt(value, 10)
    if (!Number.isNaN(parsed)) {
      if (maxContentLength === undefined || parsed > maxContentLength) {
        maxContentLength = parsed
      }
    }
  }
  return maxContentLength !== undefined && maxContentLength > maxPayloadSize
}

function toIngressBytes(value: unknown): Uint8Array | undefined {
  if (typeof value === 'string') {
    return textEncoder.encode(value)
  }

  if (Buffer.isBuffer(value)) {
    // Create a zero-copy Uint8Array view over the Buffer's underlying memory.
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }

  if (value instanceof Uint8Array) {
    // Reuse existing bytes; core performs the single defensive copy.
    return value
  }

  if (value instanceof ArrayBuffer) {
    // Create a view without copying; core performs the single defensive copy.
    return new Uint8Array(value)
  }

  return undefined
}

function extractIngressBytes(req: FastifyRequest): Uint8Array | undefined {
  // Only use rawBody — set explicitly by Fastify's rawBody plugin/config.
  // Falling back to req.body would create signature non-determinism: the same logical
  // payload would produce different signatures depending on middleware configuration.
  const rawBody = Reflect.get(req, 'rawBody')
  return toIngressBytes(rawBody)
}

/**
 * Default scent extraction from Fastify request.
 */
function defaultExtractScent(
  req: FastifyRequest,
  opts: Pick<TracehoundPluginOptions, 'maxPayloadSize' | 'resolveSourceIp' | '_now'>,
): Scent {
  const ip = opts.resolveSourceIp?.(req) ?? (req.ip || 'unknown')
  const rawUserAgentHeader = req.headers['user-agent'] as string | string[] | undefined
  // Multiple User-Agent headers are anomalous (RFC 7230 §3.2.2 forbids duplicates for
  // fields that must not be repeated). Take the first value as canonical and record the
  // anomaly in the payload for forensic context.
  let userAgentHeader: string | undefined
  let hasMultipleUserAgents = false
  if (typeof rawUserAgentHeader === 'string') {
    userAgentHeader = rawUserAgentHeader
  } else if (Array.isArray(rawUserAgentHeader) && rawUserAgentHeader.length > 0) {
    userAgentHeader = rawUserAgentHeader[0]
    hasMultipleUserAgents = rawUserAgentHeader.length > 1
  }
  const query = safeClone(req.query) ?? {}
  // Guard: skip body clone when Content-Length signals an oversized payload.
  // Prevents memory amplification (2x JSON.stringify+parse) before agent rejection.
  const body = isBodyOversized(req, opts.maxPayloadSize) ? undefined : safeClone(req.body)
  const ingressBytes = extractIngressBytes(req)

  // Extract TLS information if available
  const socket = req.socket as
    | (typeof req.socket & {
        getCipher?: () => { name: string; version?: string } | null
        getProtocol?: () => string | null
        alpnProtocol?: string | false | null
      })
    | undefined
  const cipher = socket?.getCipher?.() ?? undefined
  const tlsVersion = socket?.getProtocol?.() ?? undefined
  const alpnProtocol = socket?.alpnProtocol ?? undefined
  const tlsAlpn =
    typeof alpnProtocol === 'string' && alpnProtocol.length > 0 ? alpnProtocol : undefined

  // Extract path without query string for consistency with Express adapter.
  // req.url includes the query string (e.g. /path?foo=bar); query is captured separately.
  const qIndex = req.url.indexOf('?')
  const urlPath = qIndex === -1 ? req.url : req.url.slice(0, qIndex)

  const contentType =
    typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : ''
  const headers: Record<string, JsonSerializable> = {
    'user-agent': userAgentHeader || '',
    'content-type': contentType,
  }
  if (hasMultipleUserAgents) {
    // Forensic anomaly flag: multiple User-Agent headers are non-standard and
    // may indicate request smuggling or header injection attempts.
    headers['x-multiple-user-agents'] = 'true'
  }

  const payload: Record<string, JsonSerializable> = {
    method: req.method ?? '',
    path: urlPath,
    query,
    headers,
  }

  if (body !== undefined) {
    payload['body'] = body
  }

  const source: ScentSource = {
    ip,
    ...(userAgentHeader ? { userAgent: userAgentHeader } : {}),
    ...(cipher
      ? {
          tls: {
            cipherSuite: cipher.name,
            version: tlsVersion || 'unknown',
            ...(tlsAlpn ? { alpn: tlsAlpn } : {}),
          },
        }
      : {}),
  }

  return {
    id: generateSecureId(),
    timestamp: (opts._now ?? defaultNow)(),
    source,
    payload,
    ...(ingressBytes ? { ingressBytes } : {}),
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
      // Default adapter behavior is fail-open for internal Tracehound errors.
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
  const { agent, onIntercept } = options
  const extractScent =
    options.extractScent ?? ((req: FastifyRequest) => defaultExtractScent(req, options))

  fastify.addHook('onRequest', (req, reply, hookDone) => {
    try {
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
      // Forward-compat fail-open: continue if no response was sent.
      if (!reply.sent) {
        hookDone()
      }
    } catch (error: unknown) {
      // Preserve Fastify error pipeline after partial writes from custom handlers.
      if (reply.sent) {
        hookDone(error instanceof Error ? error : undefined)
        return
      }

      // Fail-open invariant: adapter failures must never block host traffic flow.
      hookDone()
    }
  })

  done()
}

/**
 * Create Tracehound plugin (alias).
 */
export const createPlugin = tracehoundPlugin

// Re-export types for convenience
export type { InterceptResult, Scent } from '@tracehound/core'
