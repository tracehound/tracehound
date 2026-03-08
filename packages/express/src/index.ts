/**
 * @tracehound/express
 *
 * Express middleware for Tracehound security buffer.
 */

import {
  generateSecureId,
  recordTraceInspectionEntry,
  type IAgent,
  type InterceptResult,
  type JsonSerializable,
  type Scent,
  type ScentSource,
} from "@tracehound/core";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { Buffer } from "node:buffer";

/**
 * Middleware configuration options.
 */
export interface TracehoundMiddlewareOptions {
  /**
   * Tracehound Agent instance.
   * Required - must be created via createAgent() from @tracehound/core.
   */
  agent: IAgent;

  /**
   * If true, includes the Tracehound `signature` in the HTTP 403 Forbidden body
   * for quarantined requests. This is false by default to prevent correlation attacks.
   */
  emitSignatureInResponse?: boolean;

  /**
   * If true, emits x-tracehound-trace-id for quarantined responses.
   * Disabled by default for privacy-sensitive environments.
   */
  emitTraceIdHeader?: boolean;

  /**
   * Custom scent extraction function.
   * Default extracts IP, path, method, and headers safely.
   */
  extractScent?: (req: Request) => Scent;

  /**
   * Custom response handler for intercepted requests.
   * Default sends appropriate HTTP status codes.
   */
  onIntercept?: (result: InterceptResult, req: Request, res: Response) => void;
}

const textEncoder = new TextEncoder();

/**
 * Defensive clone for safely copying deeply nested or cyclical external payloads
 * without crashing the process.
 */
function safeClone(obj: unknown): JsonSerializable | undefined {
  if (obj === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(obj)) as JsonSerializable;
  } catch {
    return undefined; // Unsafe to clone or cyclical, omit silently
  }
}

function toIngressBytes(value: unknown): Uint8Array | undefined {
  if (typeof value === "string") {
    return textEncoder.encode(value);
  }

  if (Buffer.isBuffer(value)) {
    // Create a zero-copy Uint8Array view over the Buffer's underlying memory.
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  if (value instanceof Uint8Array) {
    // Reuse existing bytes; core performs the single defensive copy.
    return value;
  }

  if (value instanceof ArrayBuffer) {
    // Create a view without copying; core performs the single defensive copy.
    return new Uint8Array(value);
  }

  return undefined;
}

function extractIngressBytes(req: Request): Uint8Array | undefined {
  // Only use rawBody — set explicitly by body-parser middleware (e.g. verify callback).
  // Falling back to req.body would create signature non-determinism: the same logical
  // payload would produce different signatures depending on middleware configuration.
  const rawBody = Reflect.get(req, "rawBody");
  return toIngressBytes(rawBody);
}

/**
 * Default scent extraction from Express request.
 */
function defaultExtractScent(req: Request): Scent {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const userAgentHeader = req.get("user-agent");
  const query = safeClone(req.query) ?? {};
  const body = safeClone(req.body);
  const ingressBytes = extractIngressBytes(req);

  // Extract TLS information if available
  const socket = req.socket as
    | (typeof req.socket & {
        getCipher?: () => { name: string } | null;
        getProtocol?: () => string | null;
        alpnProtocol?: string | false | null;
      })
    | undefined;
  const cipher = socket?.getCipher?.() ?? undefined;
  const tlsVersion = socket?.getProtocol?.() ?? undefined;
  const alpnRaw = socket?.alpnProtocol ?? undefined;
  const tlsAlpn =
    typeof alpnRaw === "string" && alpnRaw.length > 0 ? alpnRaw : undefined;

  const payload: Record<string, JsonSerializable> = {
    method: req.method,
    path: req.path,
    query,
    headers: {
      "user-agent": userAgentHeader || "",
      "content-type": req.get("content-type") || "",
    },
  };

  if (body !== undefined) {
    payload["body"] = body;
  }

  const source: ScentSource = {
    ip,
    ...(userAgentHeader ? { userAgent: userAgentHeader } : {}),
    ...(cipher
      ? {
          tls: {
            cipherSuite: cipher.name,
            version: tlsVersion || "unknown",
            ...(tlsAlpn ? { alpn: tlsAlpn } : {}),
          },
        }
      : {}),
  };

  return {
    id: generateSecureId(),
    timestamp: Date.now(),
    source,
    payload,
    ...(ingressBytes ? { ingressBytes } : {}),
  };
}

/**
 * Default intercept result handler.
 */
function defaultOnIntercept(
  result: InterceptResult,
  req: Request,
  res: Response,
  options?: Pick<
    TracehoundMiddlewareOptions,
    "emitSignatureInResponse" | "emitTraceIdHeader"
  >,
): void {
  switch (result.status) {
    case "rate_limited":
      res.set("Retry-After", String(Math.ceil(result.retryAfter / 1000)));
      res.status(429).json({
        error: "Too Many Requests",
        retryAfter: result.retryAfter,
      });
      break;

    case "payload_too_large":
      res.status(413).json({
        error: "Payload Too Large",
        limit: result.limit,
      });
      break;

    case "quarantined":
      if (options?.emitTraceIdHeader) {
        const traceId = generateSecureId();
        const source = req.ip || req.socket.remoteAddress || "unknown";

        res.set("x-tracehound-trace-id", traceId);
        recordTraceInspectionEntry({
          traceId,
          signature: result.handle.signature,
          severity: result.handle.severity,
          size: result.handle.size,
          captured: result.handle.captured,
          source,
        });
      }

      res.status(403).json({
        error: "Forbidden",
        ...(options?.emitSignatureInResponse
          ? { signature: result.handle.signature }
          : {}),
      });
      break;

    case "error":
      res.status(500).json({
        error: "Internal Server Error",
      });
      break;

    default:
      // clean, ignored - should not reach here
      break;
  }
}

/**
 * Create Tracehound middleware for Express.
 *
 * @example
 * ```ts
 * import express from 'express'
 * import { tracehound } from '@tracehound/express'
 * import { createTracehound } from '@tracehound/core'
 *
 * const app = express()
 * const th = createTracehound({ }) // options here
 *
 * app.use(tracehound({ agent: th.agent }))
 * ```
 */
export function tracehound(
  options: TracehoundMiddlewareOptions,
): RequestHandler {
  const { agent, extractScent = defaultExtractScent, onIntercept } = options;

  const interceptHandler =
    onIntercept ||
    ((result, req, res) => {
      const interceptOptions: Pick<
        TracehoundMiddlewareOptions,
        "emitSignatureInResponse" | "emitTraceIdHeader"
      > = {};

      if (options.emitSignatureInResponse !== undefined) {
        interceptOptions.emitSignatureInResponse =
          options.emitSignatureInResponse;
      }
      if (options.emitTraceIdHeader !== undefined) {
        interceptOptions.emitTraceIdHeader = options.emitTraceIdHeader;
      }

      defaultOnIntercept(result, req, res, interceptOptions);
    });

  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const scent = extractScent(req);
      const result = agent.intercept(scent);

      if (result.status === "clean" || result.status === "ignored") {
        next();
        return;
      }

      const isDefaultTerminalStatus =
        result.status === "rate_limited" ||
        result.status === "payload_too_large" ||
        result.status === "quarantined" ||
        result.status === "error";

      interceptHandler(result, req, res);

      // Forward-compat fail-open:
      // - default handler: pass through unknown statuses
      // - custom handler: pass through when no response was sent
      if (onIntercept) {
        if (!res.headersSent) {
          next();
        }
        return;
      }

      if (!isDefaultTerminalStatus) {
        next();
      }
    } catch (error: unknown) {
      // Preserve Express error pipeline after partial writes from custom handlers.
      if (res.headersSent) {
        next(error);
        return;
      }

      // Fail-open invariant: adapter failures must never block host traffic flow.
      next();
    }
  };
}

/**
 * Create Tracehound middleware (alias for tracehound).
 */
export const createMiddleware = tracehound;

// Re-export types for convenience
export type { InterceptResult, Scent } from "@tracehound/core";
