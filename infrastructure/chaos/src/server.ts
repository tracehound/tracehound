import {
  SYSTEM_SNAPSHOT_ENV,
  createTracehound,
  generateSecureId,
  getTraceRegistryStats,
  listTraceInspectionEntries,
  type JsonSerializable,
} from '@tracehound/core'
import { tracehound } from '@tracehound/express'
import express, { type Request } from 'express'
import { Buffer } from 'node:buffer'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '../../..')
const HOUND_PROCESS_PATH = resolve(REPO_ROOT, 'packages/core/dist/core/hound-process.js')
const MAX_RECENT_PANICS = 32
const MAX_PAYLOAD_SIZE = 5_000_000
const port = 3000

interface PanicSnapshot {
  readonly timestamp: number
  readonly level: 'warning' | 'critical' | 'fatal'
  readonly reason: string
}

const snapshotPath = process.env[SYSTEM_SNAPSHOT_ENV.PATH]
const snapshotSecret = process.env[SYSTEM_SNAPSHOT_ENV.SECRET]

const th = createTracehound({
  maxPayloadSize: MAX_PAYLOAD_SIZE,
  houndPool: {
    poolSize: 2,
    timeout: 100,
    onPoolExhausted: 'defer',
    deferQueueLimit: 10,
    processScriptPath: HOUND_PROCESS_PATH,
  },
  quarantine: {
    maxCount: 1_000,
    maxBytes: 10_000_000,
  },
  rateLimit: {
    windowMs: 60_000,
    maxRequests: 50_000,
    blockDurationMs: 60_000,
  },
  watcher: {
    maxAlertsPerWindow: 20,
    alertWindowMs: 60_000,
    quarantineHighWatermark: 0.85,
  },
  ...(snapshotPath && snapshotSecret
    ? {
        snapshot: {
          path: snapshotPath,
          secret: snapshotSecret,
          intervalMs: 250,
        },
      }
    : {}),
})

const recentPanics: PanicSnapshot[] = []
th.notifications.on('system.panic', (event) => {
  const payload = event.payload
  if (!isSystemPanicPayload(payload)) {
    return
  }

  recentPanics.push({
    timestamp: event.timestamp,
    level: payload.level,
    reason: payload.reason,
  })
  if (recentPanics.length > MAX_RECENT_PANICS) {
    recentPanics.shift()
  }
})

const app = express()
app.disable('x-powered-by')

app.use(
  express.json({
    limit: MAX_PAYLOAD_SIZE + 1_000, // Add some buffer to allow for metadata overhead
    verify: (req, _res, buf) => {
      Reflect.set(req, 'rawBody', Buffer.from(buf))
    },
  }),
)

app.use(
  tracehound({
    agent: th.agent,
    emitTraceIdHeader: true,
    extractScent: (req) => createChaosScent(req),
  }),
)

app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    snapshotConfigured: snapshotPath !== undefined && snapshotSecret !== undefined,
  })
})

app.get('/api/chaos/runtime', (_req, res) => {
  const traceRegistryStats = getTraceRegistryStats()
  const latestTraceEntries = listTraceInspectionEntries(20).map((entry) => ({
    traceId: entry.traceId,
    signature: entry.signature,
    severity: entry.severity,
    size: entry.size,
    captured: entry.captured,
    source: entry.source,
    recordedAt: entry.recordedAt,
  }))

  res.status(200).json({
    status: 'ok',
    snapshot: th.snapshot(),
    notifications: th.notifications.stats,
    traceRegistry: {
      ...traceRegistryStats,
      latestEntries: latestTraceEntries,
    },
    recentPanics,
    paths: {
      snapshot: snapshotPath ?? null,
      traceRegistry: process.env['TRACEHOUND_TRACE_REGISTRY_PATH'] ?? null,
    },
  })
})

app.post('/api/data', (_req, res) => {
  res.status(200).json({ message: 'Data received' })
})

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`[Chaos Server] Tracehound target application listening on port ${port}`)
  console.log(`[Chaos Server] HoundPool processScriptPath: ${HOUND_PROCESS_PATH}`)
  console.log(`[Chaos Server] Snapshot path: ${snapshotPath ?? 'disabled'}`)
  console.log(
    `[Chaos Server] Trace registry path: ${process.env['TRACEHOUND_TRACE_REGISTRY_PATH'] ?? 'default'}`,
  )
})

function createChaosScent(req: Request): {
  id: string
  timestamp: number
  source: { ip: string; userAgent?: string }
  payload: JsonSerializable
  ingressBytes?: Uint8Array
  threat?: { category: 'injection'; severity: 'critical' }
} {
  const requestId = getFirstHeaderValue(req.headers['x-request-id'])
  const userAgent = getFirstHeaderValue(req.headers['user-agent'])
  const contentType = getFirstHeaderValue(req.headers['content-type'])
  const query = safeClone(req.query) ?? {}
  const body = safeClone(req.body) ?? {}
  const ingressBytes = extractIngressBytes(req)

  const payload: Record<string, JsonSerializable> = {
    requestId: requestId ?? '',
    method: req.method,
    path: req.path,
    query,
    body,
    headers: {
      'content-type': contentType ?? '',
      'x-chaos-threat': getFirstHeaderValue(req.headers['x-chaos-threat']) ?? '',
    },
  }

  return {
    id: `chaos-${generateSecureId()}`,
    timestamp: Date.now(),
    source: {
      ip: req.ip || req.socket.remoteAddress || '127.0.0.1',
      ...(userAgent ? { userAgent } : {}),
    },
    payload,
    ...(ingressBytes ? { ingressBytes } : {}),
    ...(req.headers['x-chaos-threat']
      ? {
          threat: {
            category: 'injection',
            severity: 'critical',
          },
        }
      : {}),
  }
}

const encoder = new TextEncoder()

function extractIngressBytes(req: Request): Uint8Array | undefined {
  const rawBody = Reflect.get(req, 'rawBody')
  if (typeof rawBody === 'string') {
    return encoder.encode(rawBody)
  }
  if (Buffer.isBuffer(rawBody)) {
    return new Uint8Array(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength)
  }
  if (rawBody instanceof Uint8Array) {
    return rawBody
  }
  if (rawBody instanceof ArrayBuffer) {
    return new Uint8Array(rawBody)
  }

  return undefined
}

function getFirstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0]
  }

  return value
}

function safeClone(value: unknown): JsonSerializable | undefined {
  if (value === undefined) {
    return undefined
  }

  try {
    return JSON.parse(JSON.stringify(value)) as JsonSerializable
  } catch {
    return undefined
  }
}

function isSystemPanicPayload(
  value: unknown,
): value is { level: 'warning' | 'critical' | 'fatal'; reason: string } {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as { level?: unknown; reason?: unknown }
  return (
    (candidate.level === 'warning' ||
      candidate.level === 'critical' ||
      candidate.level === 'fatal') &&
    typeof candidate.reason === 'string'
  )
}

function shutdown(signal: string): void {
  console.log(`[Chaos Server] Received ${signal}, shutting down.`)
  server.close(() => {
    th.shutdown()
    process.exit(0)
  })

  setTimeout(() => {
    process.exit(1)
  }, 5_000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
