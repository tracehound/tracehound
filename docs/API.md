# @tracehound/core API Reference

## Installation

```bash
npm install @tracehound/core
```

## Core Components

### Agent

The main entry point for intercepting requests.

```ts
import { createAgent, createQuarantine, createRateLimiter } from '@tracehound/core'

const agent = createAgent({
  quarantine: createQuarantine({ maxCount: 10000, maxBytes: 100_000_000 }),
  rateLimiter: createRateLimiter({ windowMs: 60_000, maxRequests: 100 }),
})

const result = agent.intercept(scent)
```

#### `agent.intercept(scent: Scent): InterceptResult`

Process a scent through the security pipeline.

**Returns:**

- `{ status: 'clean' }` - No threat detected
- `{ status: 'rate_limited', retryAfter: number }` - Rate limit exceeded
- `{ status: 'payload_too_large', limit: number }` - Payload exceeds limit
- `{ status: 'quarantined', handle: EvidenceHandle }` - Threat quarantined
- `{ status: 'ignored', signature: string }` - Duplicate threat
- `{ status: 'error', error: string }` - Processing error

---

### Quarantine

Evidence buffer with priority-based eviction.

```ts
import { createQuarantine } from '@tracehound/core'

const quarantine = createQuarantine({
  maxCount: 10000, // Max evidence count
  maxBytes: 100_000_000, // Max bytes (100MB)
})
```

---

### RateLimiter

Token bucket rate limiter with source blocking.

```ts
import { createRateLimiter } from '@tracehound/core'

const rateLimiter = createRateLimiter({
  windowMs: 60_000, // Time window
  maxRequests: 100, // Max requests per window
  blockDuration: 300_000, // Block duration when exceeded
})
```

---

### Scheduler

Jittered tick scheduler for background tasks.

```ts
import { createScheduler } from '@tracehound/core'

const scheduler = createScheduler({
  tickInterval: 1000, // Base interval
  jitterMs: 100, // Random jitter
})

scheduler.schedule(
  'cleanup',
  async () => {
    // Background task
  },
  { priority: 1 }
)

scheduler.start()
```

---

### Watcher

Pull-based observability for threat statistics.

```ts
import { createWatcher } from '@tracehound/core'

const watcher = createWatcher({
  quarantine,
  auditChain,
})

const snapshot = watcher.getSnapshot()
console.log(snapshot.stats)
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

### Hashing

```ts
import { hash, hashBuffer } from '@tracehound/core'

hash('data') // SHA-256 hex string
hashBuffer(uint8array) // SHA-256 hex from buffer
```

### Binary Codec

```ts
import {
  createColdPathCodec,
  encodeWithIntegrity,
  verify,
  decodeWithIntegrity,
} from '@tracehound/core'

// Compression (sync — hot-path)
const codec = createColdPathCodec()
const compressed = codec.encode(buffer)
const decompressed = codec.decode(compressed)

// Integrity (cold storage)
const encoded = encodeWithIntegrity(data)
if (verify(encoded)) {
  const decoded = decodeWithIntegrity(encoded)
}
```

### Async Codec (v1.1.0+)

Non-blocking codec for cold storage and background operations.

```ts
import {
  createAsyncColdPathCodec,
  encodeWithIntegrityAsync,
  decodeWithIntegrityAsync,
  verify,
} from '@tracehound/core'

// Async compression (non-blocking — cold-path)
const asyncCodec = createAsyncColdPathCodec()
const compressed = await asyncCodec.encode(buffer)
const decompressed = await asyncCodec.decode(compressed)

// Async integrity (cold storage write/read)
const encoded = await encodeWithIntegrityAsync(data)
if (verify(encoded)) {
  const decoded = await decodeWithIntegrityAsync(encoded)
}
```

**Note:** Async codec produces byte-identical output to sync codec. Sync and async encoded payloads are fully interoperable.

---

### S3 Cold Storage (v1.1.0+)

S3-compatible cold storage adapter. Supports AWS S3, Cloudflare R2, GCS, MinIO.

```ts
import { createS3ColdStorage } from '@tracehound/core'
import type { S3LikeClient } from '@tracehound/core'

// Provide your own S3-compatible client (zero AWS SDK dependency in core)
const client: S3LikeClient = {
  putObject: (p) => s3.send(new PutObjectCommand(p)).then(() => {}),
  getObject: (p) => s3.send(new GetObjectCommand(p)).then(r => ({
    Body: new Uint8Array(await r.Body!.transformToByteArray())
  })),
  deleteObject: (p) => s3.send(new DeleteObjectCommand(p)).then(() => {}),
  headBucket: (p) => s3.send(new HeadBucketCommand(p)).then(() => {}),
}

const coldStorage = createS3ColdStorage({
  client,
  bucket: 'tracehound-evidence',
  prefix: 'prod/evidence/',
})

// Write evidence
const result = await coldStorage.write('ev-001', encodedPayload)

// Read evidence
const readResult = await coldStorage.read('ev-001')

// Check availability
const available = await coldStorage.isAvailable()
```

---

## Adapters

- [@tracehound/express](./packages/express/README.md) - Express middleware
- [@tracehound/fastify](./packages/fastify/README.md) - Fastify plugin
