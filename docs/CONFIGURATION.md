# Configuration Reference

Tracehound configuration is split into:

1. Core runtime initialization (`createTracehound`)
2. Optional direct `Agent` construction for advanced wiring
3. Cold storage buffering policy (memory-first by default)
4. Adapter-level behavior flags for Express/Fastify

## 1. Core Runtime (`createTracehound`)

```ts
import { createTracehound } from '@tracehound/core'

const th = createTracehound({
  maxPayloadSize: 1_000_000,
  quarantine: {
    maxCount: 10_000,
    maxBytes: 100_000_000,
  },
  rateLimit: {
    windowMs: 60_000,
    maxRequests: 100,
    blockDurationMs: 300_000,
  },
  watcher: {
    maxAlertsPerWindow: 10,
    alertWindowMs: 60_000,
    quarantineHighWatermark: 0.8,
  },
  houndPool: {
    poolSize: 4,
    timeout: 30_000,
    rotationJitterMs: 1_000,
    onPoolExhausted: 'defer',
    deferQueueLimit: 100,
  },
})
```

Defaults:

| Option | Default |
| --- | --- |
| `maxPayloadSize` | `1_000_000` |
| `quarantine.maxCount` | `10_000` |
| `quarantine.maxBytes` | `100_000_000` |
| `rateLimit.windowMs` | `60_000` |
| `rateLimit.maxRequests` | `100` |
| `rateLimit.blockDurationMs` | `300_000` |
| `watcher.maxAlertsPerWindow` | `10` |
| `watcher.alertWindowMs` | `60_000` |
| `watcher.quarantineHighWatermark` | `0.8` |
| `houndPool.poolSize` | `4` |
| `houndPool.timeout` | `30_000` |
| `houndPool.rotationJitterMs` | `1_000` |
| `houndPool.onPoolExhausted` | `'defer'` |
| `houndPool.deferQueueLimit` | `100` |

## 2. Direct Agent Configuration (Advanced)

For direct `Agent` construction, `coordinationProvider` is optional and fail-open compatible:

```ts
import { Agent } from '@tracehound/core'

const agent = new Agent(
  {
    maxPayloadSize: 1_000_000,
    coordinationProvider, // optional
  },
  quarantine,
  rateLimiter,
  evidenceFactory,
)
```

Coordination health modes:

- `local`
- `degraded`
- `synchronized`

Provider contract/health failures degrade safely (`degraded`) without interrupting intercept flow.

## 3. Cold Storage Buffering Policy (RFC-0011)

`MemoryColdStorage` is memory-first by default. Disk buffering is explicit opt-in.

```ts
import { createMemoryColdStorage } from '@tracehound/core'

// Default (memory-only, bounded)
const memoryOnly = createMemoryColdStorage({
  maxEntries: 1_024,
  maxBytes: 8 * 1024 * 1024,
})

// Explicit disk opt-in
const diskBacked = createMemoryColdStorage({
  maxEntries: 1_024,
  maxBytes: 8 * 1024 * 1024,
  diskBuffer: {
    enabled: true,
    path: './tracehound-cold-storage.ndjson',
    maxQueueEntries: 1_024,
  },
})
```

## 4. Adapter Configuration

### Express and Fastify Options

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `agent` | `IAgent` | required | Core intercept engine |
| `emitSignatureInResponse` | `boolean` | `false` | Adds signature to `403` body when enabled |
| `emitTraceIdHeader` | `boolean` | `false` | Emits `x-tracehound-trace-id` for quarantined responses |
| `extractScent` | function | adapter default | Custom request-to-scent extraction |
| `onIntercept` | function | adapter default | Custom intercept response handling |

### Adapter Response Mapping

| Intercept status | HTTP response |
| --- | --- |
| `clean` / `ignored` | pass-through |
| `rate_limited` | `429` (+ `Retry-After`) |
| `payload_too_large` | graceful `413` |
| `quarantined` | `403` |
| `error` | `500` |

`payload_too_large` handling is graceful and does not rely on destructive socket reset semantics.

### Adapter Error Flow

- If interception/extraction fails before response starts, adapters remain fail-open and pass through.
- If a custom intercept handler throws after headers are already sent, the error is propagated to the framework error pipeline.
