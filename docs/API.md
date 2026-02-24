# API & Configuration Reference

> **Tracehound Core v1.4+** uses a unified `createTracehound` factory that encapsulates all sub-components (Agent, Quarantine, Watcher, HoundPool, etc.) behind a single, cohesive facade.

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

### TracehoundOptions Configuration

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
- `{ status: 'quarantined', handle: EvidenceHandle }` - Threat quarantined
- `{ status: 'ignored', signature: string }` - Duplicate threat
- `{ status: 'error', error: TracehoundError }` - Processing error

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
const snapshot = th.watcher.getSnapshot()
console.log(snapshot.stats)
```

### Notifications (`th.notifications`)

Subscribe to internal system events (e.g., panic, thread detection, quarantine).

```ts
th.notifications.on('threat.detected', (payload) => {
  console.log(`[ALERT] Threat detected: ${payload.category}`)
})

th.notifications.on('system.panic', (payload) => {
  console.error(`[PANIC] System level ${payload.level}: ${payload.reason}`)
})
```

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
