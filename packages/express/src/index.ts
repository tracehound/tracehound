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
  type Scent,
} from "@tracehound/core";
import type { NextFunction, Request, RequestHandler, Response } from "express";

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

/**
 * Defensive clone for safely copying deeply nested or cyclical external payloads
 * without crashing the process.
 */
function safeClone(obj: any): any {
  if (obj === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return undefined; // Unsafe to clone or cyclical, omit silently
  }
}

/**
 * Default scent extraction from Express request.
 */
function defaultExtractScent(req: Request): Scent {
  const ip = req.ip || req.socket.remoteAddress || "unknown";

  return {
    id: generateSecureId(),
    timestamp: Date.now(),
    source: ip,
    payload: {
      method: req.method,
      path: req.path,
      query: safeClone(req.query) ?? {},
      headers: {
        "user-agent": req.get("user-agent") || "",
        "content-type": req.get("content-type") || "",
      },
      body: safeClone(req.body),
    },
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

      interceptHandler(result, req, res);
    } catch {
      // Fail-open invariant: adapter failures must never block host traffic flow.
      if (!res.headersSent) {
        next();
      }
    }
  };
}

/**
 * Create Tracehound middleware (alias for tracehound).
 */
export const createMiddleware = tracehound;

// Re-export types for convenience
export type { InterceptResult, Scent } from "@tracehound/core";
