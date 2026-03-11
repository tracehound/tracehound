/**
 * SoakServer — Express application wired with Tracehound middleware.
 *
 * Exposes an `x-soak-threat-category` / `x-soak-threat-severity` header
 * contract so the traffic generator can simulate upstream WAF threat signals
 * without introducing detection logic into the middleware itself.
 */

import {
  createTracehound,
  generateSecureId,
  type ITracehound,
  type Scent,
  type Severity,
  type ThreatCategory,
} from '@tracehound/core'
import { tracehound } from '@tracehound/express'
import express, { type Express } from 'express'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFileColdStorage } from './file-cold-storage.js'

// ─────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────────

const VALID_CATEGORIES = new Set<ThreatCategory>([
  'injection',
  'ddos',
  'flood',
  'spam',
  'malware',
  'unknown',
])

const VALID_SEVERITIES = new Set<Severity>(['low', 'medium', 'high', 'critical'])

function parseCategory(raw: string | undefined): ThreatCategory | null {
  if (raw === undefined) return null
  return VALID_CATEGORIES.has(raw as ThreatCategory) ? (raw as ThreatCategory) : null
}

function parseSeverity(raw: string | undefined): Severity | null {
  if (raw === undefined) return null
  return VALID_SEVERITIES.has(raw as Severity) ? (raw as Severity) : null
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SoakServer {
  readonly tracehound: ITracehound
  readonly httpServer: Server
  readonly port: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createSoakServer(port: number): Promise<SoakServer> {
  const th = createTracehound({
    coldStorage: createFileColdStorage(),
    maxPayloadSize: 512_000,
    houndPool: {
      poolSize: 4,
      timeout: 30_000,
      rotationJitterMs: 1000,
      onPoolExhausted: 'defer',
      deferQueueLimit: 100,
    },
    quarantine: {
      maxCount: 200,
      maxBytes: 1_000_000,
      // TTL = 30 s — decay events become visible within the first soak minute
      ttlMs: 30_000,
      decayIntervalMs: 2_000,
      decayBatchSize: 64,
    },
    rateLimit: {
      // Tight window to make rate-limit probes visible in soak metrics
      windowMs: 10_000,
      maxRequests: 30,
      blockDurationMs: 30_000,
    },
    watcher: {
      maxAlertsPerWindow: 30,
      alertWindowMs: 60_000,
      quarantineHighWatermark: 0.7,
    },
    snapshot: {
      path: join(
        fileURLToPath(import.meta.url),
        '..',
        '..',
        'logs',
        'snapshot',
        'system-snapshot.json',
      ),
      secret: process.env['TRACEHOUND_SNAPSHOT_SECRET'] ?? 'soak-test-snapshot-secret',
      intervalMs: 1_000,
    },
  })

  const app: Express = express()
  app.disable('x-powered-by')
  // Trust the X-Forwarded-For header set by the traffic generator so each
  // simulated source IP is seen by the rate limiter as a distinct client.
  // This mirrors a typical reverse-proxy deployment (nginx, ALB, Cloudflare).
  app.set('trust proxy', true)

  // Capture the raw body buffer via body-parser's verify callback so that
  // extractScent can populate ingressBytes. Without this, all requests with
  // the same method+path would produce identical signatures and be deduplicated
  // after the first hit — correct behaviour in production, but it prevents
  // quarantine accumulation in a soak test.
  app.use(
    express.json({
      // Raised above 512 kb so that oversized-body probes (512 001 – 614 400 bytes)
      // reach Tracehound before express rejects them, exercising the
      // payload_too_large intercept path.
      limit: '600kb',
      verify: (req, _res, buf) => {
        if (buf.length > 0) {
          Reflect.set(req, 'rawBody', buf)
        }
      },
    }),
  )

  // Mount Tracehound middleware with a custom scent extractor that reads
  // test-only headers set by the traffic generator. In production these headers
  // would come from an upstream WAF or threat detection service.
  app.use(
    tracehound({
      agent: th.agent,
      extractScent: (req): Scent => {
        const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
        const userAgent = req.get('user-agent')
        const category = parseCategory(req.get('x-soak-threat-category'))
        const severity = parseSeverity(req.get('x-soak-threat-severity'))

        // Read rawBody written by the body-parser verify callback above.
        // Each unique request body produces a unique SHA-256 signature, so
        // quarantine accumulates genuine distinct evidence items rather than
        // deduplicating everything against the first quarantined entry.
        const rawBody: unknown = Reflect.get(req, 'rawBody')
        const ingressBytes =
          rawBody instanceof Buffer
            ? new Uint8Array(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength)
            : undefined

        const scent: Scent = {
          id: generateSecureId(),
          timestamp: Date.now(),
          source: {
            ip,
            ...(userAgent !== undefined ? { userAgent } : {}),
          },
          payload: {
            method: req.method,
            path: req.path,
          },
          // ingressBytes drives the signature when present; each unique
          // body yields a unique evidence item.
          ...(ingressBytes !== undefined ? { ingressBytes } : {}),
          // Threat signal is injected only when both headers are valid.
          // An invalid or absent header pair is treated as clean traffic.
          ...(category !== null && severity !== null ? { threat: { category, severity } } : {}),
        }

        return scent
      },
    }),
  )

  // ── Routes ────────────────────────────────────────────────────────────────

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', ts: Date.now() })
  })

  // Generic data ingestion endpoint — primary target for injection threats
  app.post('/api/data', (req, res) => {
    const body: unknown = req.body
    const bytes = typeof body === 'object' && body !== null ? JSON.stringify(body).length : 0
    res.json({ received: true, bytes })
  })

  // Query endpoint — common surface for injection probes
  app.get('/api/search', (req, res) => {
    const q: unknown = req.query['q']
    res.json({ q: typeof q === 'string' ? q : null, results: [] })
  })

  // Auth endpoint — typical target for credential stuffing / flood threats
  app.post('/api/login', (_req, res) => {
    res.status(200).json({ token: 'soak-test-mock-token' })
  })

  // Fallback — return 404 without crashing
  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' })
  })

  const httpServer = createServer(app)

  return new Promise<SoakServer>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(port, () => {
      const addr = httpServer.address()
      const boundPort = addr !== null && typeof addr === 'object' ? addr.port : port
      resolve({ tracehound: th, httpServer, port: boundPort })
    })
  })
}
