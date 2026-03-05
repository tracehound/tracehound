# API Reference

> **Tracehound Core v1.4+** uses a unified `createTracehound` factory that encapsulates all sub-components (Agent, Quarantine, Watcher, HoundPool, etc.) behind a single, cohesive facade.

For configuration defaults and adapter behavior flags, see [CONFIGURATION.md](./CONFIGURATION.md).
For upgrade-impacting changes, see [BREAKING-CHANGES.md](./BREAKING-CHANGES.md).

## Migration Note (v1.6.0)

1. `@tracehound/fastify` now uses named export only (`tracehoundPlugin`).
2. Custom `IAgent` implementations must expose `getStats(): Readonly<AgentStats>`.
3. CLI `status/stats/watch` requires verified runtime snapshot input; no fabricated fallback state exists.
4. `ITracehound` now exposes `shutdown()` for runtime teardown.

## Installation

```bash
npm install @tracehound/core
```

## Initialization

The single entry point for initializing the entire security buffer is `createTracehound(options)`.

```ts
import { createTracehound } from '@tracehound/core'

const th = createTracehound({
  // Global options
  maxPayloadSize: 5_000_000, // 5MB

  // Component-specific options
  quarantine: {
    maxCount: 15_000,
    maxBytes: 250_000_000, // 250MB
  },
  rateLimit: {
    windowMs: 60_000,
    maxRequests: 100,
    blockDurationMs: 600_000, // 10 minutes
  },
  watcher: {
    maxAlertsPerWindow: 20,
    alertWindowMs: 60_000,
    quarantineHighWatermark: 0.85,
  },
  houndPool: {
    poolSize: 8,
    timeout: 30_000,
  },
})

// The Tracehound instance provides access to the initialized components
const { agent, quarantine, rateLimiter, watcher, auditChain, notifications, houndPool } = th
```

### TracehoundOptions Overview

Complete configuration options for `createTracehound`:

```typescript
interface TracehoundOptions {
  /** Maximum payload size in bytes. Default: 1_000_000 (1MB) */
  maxPayloadSize?: number

  /** Quarantine configuration. */
  quarantine?: {
    /** Maximum number of evidence entries. Default: 10_000 */
    maxCount?: number
    /** Maximum total bytes for all evidence. Default: 100_000_000 (100MB) */
    maxBytes?: number
  }

  /** Rate limiter configuration. */
  rateLimit?: {
    /** Time window in milliseconds. Default: 60_000 (1m) */
    windowMs?: number
    /** Maximum requests per window. Default: 100 */
    maxRequests?: number
    /** Block duration when limit exceeded. Default: 300_000 (5m) */
    blockDurationMs?: number
  }

  /** Watcher configuration (Observability). */
  watcher?: {
    /** Max alerts to emit per window. Default: 10 */
    maxAlertsPerWindow?: number
    /** Alert sliding window in ms. Default: 60_000 (1m) */
    alertWindowMs?: number
    /** Threshold ratio (0-1) to alert on quarantine capacity. Default: 0.8 */
    quarantineHighWatermark?: number
  }

  /** Hound pool configuration (Async forensic workers). */
  houndPool?: {
    /** Number of background hound workers. Default: 4 */
    poolSize?: number
    /** Timeout for hound operations in ms. Default: 30_000 */
    timeout?: number
    /** Action when pool is exhausted: 'defer' | 'drop' | 'escalate'. Default: 'defer' */
    onPoolExhausted?: 'defer' | 'drop' | 'escalate'
    /** Max items in defer queue. Default: 100 */
    deferQueueLimit?: number
    /** Jitter for rotation in ms. Default: 1000 */
    rotationJitterMs?: number
  }

  /** Signed runtime snapshot export configuration. */
  snapshot?: {
    /** Output file path (required when enabled) */
    path: string
    /** HMAC secret (fallback: TRACEHOUND_SNAPSHOT_SECRET) */
    secret?: string
    /** Flush interval in ms. Default: 1000 */
    intervalMs?: number
  }
}
```

---

## Core Components

Once initialized, the Tracehound instance exposes several critical components:

### Agent (`th.agent`)

The `agent` is the core orchestrator. Instead of detecting threats, it orchestrates rate limiting, validation, evidence generation, and quarantining based on external threat signals.

```ts
const result = th.agent.intercept(scent)
```

**Returns (`InterceptResult`):**

- `{ status: 'clean' }` - No threat detected
- `{ status: 'rate_limited', retryAfter: number }` - Rate limit exceeded
- `{ status: 'payload_too_large', limit: number }` - Payload exceeds limit
- `{ status: 'quarantined', handle: RuntimeEvidenceHandle }` - Threat quarantined (metadata-only membrane handle)
- `{ status: 'ignored', signature: string }` - Duplicate threat
- `{ status: 'error', error: TracehoundError }` - Processing error

Quarantined runtime handle is membrane-guarded: `bytes`, `transfer()`, `neutralize()`, and `evacuate()` are rejected in runtime path. Forensic byte access remains quarantine-local (`th.quarantine.get(signature)`).

Agent also exposes coordination health in a fail-open model:

```ts
const health = th.agent.getCoordinationHealth()
// health.mode: 'local' | 'degraded' | 'synchronized'
```

If no coordination provider is configured, `mode` is `local`.
If provider health retrieval fails, Agent returns `degraded` without interrupting intercept flow.
If provider contract is invalid or health lookup throws, Agent emits `system.panic` with warning level (`coordination.invalid_contract` or `coordination.health_failure`).

Agent stats are available via:

```ts
const stats = th.agent.getStats()
```

### Adapter Runtime Guarantees (Express/Fastify)

1. `payload_too_large` outcomes map to graceful HTTP `413`.
2. Oversized handling avoids destructive socket reset semantics by default.
3. Adapter interception errors are fail-open before response start.
4. If a custom intercept handler throws after headers are sent, adapters delegate to framework error pipelines.

### Quarantine (`th.quarantine`)

Evidence buffer with priority-based eviction. Evicts the lowest severity evidence first when limits are reached.

```ts
// Checking quarantine statistics
const stats = th.quarantine.stats
console.log(`Quarantine uses ${stats.bytes} bytes across ${stats.count} entries.`)

// Checking for specific evidence
const hasEvidence = th.quarantine.has('evidence-signature')
```

### Rate Limiter (`th.rateLimiter`)

Token bucket rate limiter with source blocking.

```ts
// Manually checking a source against the limits
const check = th.rateLimiter.check('192.168.1.100')
if (!check.allowed) {
  console.log(`Source limited. Retry after ${check.retryAfter} ms`)
}
```

### Watcher (`th.watcher`)

Pull-based observability for threat statistics and alerts.

```ts
const snapshot = th.watcher.snapshot()
console.log(snapshot.threats)
```

### Runtime Snapshot (`th.snapshot()`)

Operational snapshot API for signed disk export / CLI consumption:

```ts
const runtime = th.snapshot()
console.log(runtime.systemHealth)
console.log(runtime.houndPool.isolationTelemetry?.capabilities)
```

For disk transport:

```ts
import { readSystemSnapshotFromDisk, SYSTEM_SNAPSHOT_ENV } from '@tracehound/core'

const verified = readSystemSnapshotFromDisk(
  '/tmp/tracehound/system-snapshot.json',
  process.env[SYSTEM_SNAPSHOT_ENV.SECRET]!,
)
if (verified.ok) {
  console.log(verified.snapshot.generatedAt)
}
```

Environment key constants are exposed via `SYSTEM_SNAPSHOT_ENV`:

```ts
import { SYSTEM_SNAPSHOT_ENV } from '@tracehound/core'

console.log(SYSTEM_SNAPSHOT_ENV.PATH) // TRACEHOUND_SYSTEM_SNAPSHOT_PATH
console.log(SYSTEM_SNAPSHOT_ENV.SECRET) // TRACEHOUND_SNAPSHOT_SECRET
console.log(SYSTEM_SNAPSHOT_ENV.MAX_AGE_MS) // TRACEHOUND_SNAPSHOT_MAX_AGE_MS
console.log(SYSTEM_SNAPSHOT_ENV.MAX_FUTURE_SKEW_MS) // TRACEHOUND_SNAPSHOT_MAX_FUTURE_SKEW_MS
```

CLI freshness/integrity rules use the same keys:

1. Stale snapshots beyond `SYSTEM_SNAPSHOT_ENV.MAX_AGE_MS` are treated as `NO_INSTANCE`.
2. Future-dated snapshots beyond `SYSTEM_SNAPSHOT_ENV.MAX_FUTURE_SKEW_MS` are treated as `INTEGRITY_VIOLATION`.

### Runtime Teardown (`th.shutdown()`)

Stop runtime background resources (snapshot interval and hound processes):

```ts
th.shutdown()
```

### Notifications (`th.notifications`)

Subscribe to internal system events (e.g., panic, thread detection, quarantine).

```ts
import {
  HOUND_PRESSURE_ERRORS,
  formatHoundErrorReason,
  formatHoundTimeoutReason,
  SYSTEM_PANIC_REASONS,
} from '@tracehound/core'

th.notifications.on('threat.detected', (payload) => {
  console.log(`[ALERT] Threat detected: ${payload.category}`)
})

const timeoutReasonExample = formatHoundTimeoutReason('sig-123')

th.notifications.on('system.panic', (payload) => {
  console.error(`[PANIC] System level ${payload.level}: ${payload.reason}`)

  if (payload.reason === formatHoundErrorReason(HOUND_PRESSURE_ERRORS.POOL_EXHAUSTED)) {
    // capacity pressure handling
  }
  if (payload.reason.startsWith(SYSTEM_PANIC_REASONS.HOUND_TIMEOUT_SIGNATURE_PREFIX)) {
    // timeout handling
  }
  if (payload.reason === timeoutReasonExample) {
    // exact timeout match for known signature
  }
})
```

`system.panic` reason patterns used by runtime:

1. `hound_timeout: signature=<signature>`
2. `hound_error: <error_code_or_message>`
3. `snapshot_write_failed`
4. `snapshot_cleanup_failed`
5. `coordination.invalid_contract`
6. `coordination.health_failure`
7. `membrane.payload_egress_blocked`

These reason values are stable string patterns that you can match directly in telemetry pipelines.

---

## Types

### Scent

Input to the security pipeline.

```ts
interface Scent {
  id: string // Unique ID (UUIDv7)
  timestamp: number // Capture time (ms)
  source: string // Origin (IP, user agent)
  payload: JsonSerializable
  threat?: ThreatSignal
}
```

### ThreatSignal

External detector classification.

```ts
interface ThreatSignal {
  category: 'injection' | 'ddos' | 'flood' | 'spam' | 'malware' | 'unknown'
  severity: 'low' | 'medium' | 'high' | 'critical'
}
```

---

### Coordination Contract Types (RFC-0009 Draft)

The core package now exposes coordination boundary contracts for external provider integrations. These are type-only contracts and do not change runtime behavior.

```ts
import type {
  CoordinationFeature,
  CoordinationHealth,
  CoordinationProvider,
} from '@tracehound/core'

const provider: CoordinationProvider = {
  providerId: 'external-provider',
  features: new Set<CoordinationFeature>(['shared_blocklist']),
  async start() {},
  async stop() {},
  health(): CoordinationHealth {
    return {
      mode: 'local',
      lastSyncAt: null,
      syncLagMs: null,
      provider: 'external-provider',
    }
  },
}
```

## Utilities

### ID Generation

```ts
import { generateSecureId, isValidSecureId } from '@tracehound/core'

const id = generateSecureId() // UUIDv7
isValidSecureId(id) // true
```

### Security State & Serialization

```ts
import { hash, hashBuffer, serialize } from '@tracehound/core'

hash('data') // SHA-256 hex string
hashBuffer(uint8array) // SHA-256 hex from buffer
const stringified = serialize({ complex: 'object' }) // Deterministic JSON
```

### Async Binary Codec (v1.1.0+)

Non-blocking compression and integrity codec for cold storage and background operations. Produces byte-identical output to the sync codec `createColdPathCodec`.

```ts
import {
  createAsyncColdPathCodec,
  encodeWithIntegrityAsync,
  decodeWithIntegrityAsync,
  verify,
} from '@tracehound/core'

// Async compression (non-blocking)
const asyncCodec = createAsyncColdPathCodec()
const compressed = await asyncCodec.encode(buffer)
const decompressed = await asyncCodec.decode(compressed)

// Async integrity (cold storage read/write)
const encoded = await encodeWithIntegrityAsync(data)
if (verify(encoded)) {
  const decoded = await decodeWithIntegrityAsync(encoded)
}
```

### S3 Cold Storage (v1.1.0+)

S3-compatible cold storage adapter (AWS S3, Cloudflare R2, GCS, MinIO) with zero AWS SDK dependency in core logic.

```ts
import { createS3ColdStorage } from '@tracehound/core'
import type { S3LikeClient } from '@tracehound/core'

// Construct a client conforming to `S3LikeClient`
const client: S3LikeClient = {
  putObject: async (p) => {
    /* AWS SDK call */
  },
  getObject: async (p) => {
    /* AWS SDK call returning Uint8Array Body */
  },
  deleteObject: async (p) => {
    /* AWS SDK call */
  },
  headBucket: async (p) => {
    /* AWS SDK call */
  },
}

const coldStorage = createS3ColdStorage({
  client,
  bucket: 'tracehound-evidence',
  prefix: 'prod/evidence/',
})

await coldStorage.write('ev-001', encodedPayload)
```

---

## Integrations

- [@tracehound/express](../packages/express/README.md) - Express middleware
- [@tracehound/fastify](../packages/fastify/README.md) - Fastify plugin
