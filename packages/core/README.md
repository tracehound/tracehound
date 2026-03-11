# @tracehound/core

Deterministic runtime security buffer for high-velocity APIs.

Tracehound is decision-free: it does not detect threats. External systems provide the threat signal, Tracehound preserves forensic evidence.

## Installation

```bash
pnpm add @tracehound/core
# or
npm install @tracehound/core
```

## Quick Start

```ts
import { createTracehound, generateSecureId, type Scent } from '@tracehound/core'

const th = createTracehound({
  maxPayloadSize: 1_000_000,
  quarantine: {
    maxCount: 10_000,
    maxBytes: 100_000_000,
  },
  rateLimit: {
    windowMs: 60_000,
    maxRequests: 100,
  },
})

const scent: Scent = {
  id: generateSecureId(),
  timestamp: Date.now(),
  source: {
    ip: '203.0.113.10',
    userAgent: 'curl/8.7.1',
  },
  payload: {
    method: 'POST',
    path: '/api/login',
    body: { username: 'alice' },
  },
  threat: {
    category: 'injection',
    severity: 'high',
  },
}

const result = th.agent.intercept(scent)

if (result.status === 'quarantined') {
  console.log(result.handle.signature)
  console.log(result.handle.membrane) // metadata_only
}

th.shutdown()
```

## Intercept Contract

`agent.intercept(scent)` returns `InterceptResult`:

- `clean`: no threat signal on the `Scent`
- `rate_limited`: source exceeded rate limit window
- `payload_too_large`: payload exceeded `maxPayloadSize`
- `ignored`: duplicate signature or deterministic pressure drop
- `quarantined`: evidence stored; runtime gets metadata-only handle
- `error`: internal failure; runtime can fail-open

## Scent Contract

```ts
interface Scent {
  id: string
  timestamp: number
  source: {
    ip: string
    userAgent?: string
    tls?: {
      cipherSuite: string
      version: string
      alpn?: string
    }
  }
  payload: JsonSerializable
  ingressBytes?: Uint8Array | ArrayBuffer
  threat?: {
    category: 'injection' | 'ddos' | 'flood' | 'spam' | 'malware' | 'unknown'
    severity: 'low' | 'medium' | 'high' | 'critical'
  }
}
```

Notes:

- If `threat` is absent, result is `clean` (decision-free behavior).
- If `ingressBytes` exists, signature generation uses raw ingress bytes instead of canonicalized payload bytes.

## createTracehound Options

```ts
createTracehound({
  maxPayloadSize?: number,
  quarantine?: {
    maxCount?: number,
    maxBytes?: number,
    ttlMs?: number,
    decayIntervalMs?: number,
    decayBatchSize?: number,
    archiveOnDecay?: boolean,
    archiveFailureMode?: 'drop' | 'retain',
    archiveTimeoutMs?: number,
  },
  coldStorage?: IColdStorageAdapter,
  rateLimit?: {
    windowMs?: number,
    maxRequests?: number,
    blockDurationMs?: number,
  },
  watcher?: {
    maxAlertsPerWindow?: number,
    alertWindowMs?: number,
    quarantineHighWatermark?: number,
  },
  houndPool?: Partial<HoundPoolConfig>,
  snapshot?: {
    path: string,
    secret?: string,
    intervalMs?: number,
  },
})
```

## Runtime Snapshot and CLI Integration

When `snapshot` is enabled, Tracehound writes signed runtime snapshots for CLI consumption.

- HMAC secret comes from `snapshot.secret` or `TRACEHOUND_SNAPSHOT_SECRET`
- Missing secret causes `createTracehound()` to throw
- Use env constants via `SYSTEM_SNAPSHOT_ENV`

```ts
import { SYSTEM_SNAPSHOT_ENV } from '@tracehound/core'

process.env[SYSTEM_SNAPSHOT_ENV.PATH] = '/var/run/tracehound/system-snapshot.json'
process.env[SYSTEM_SNAPSHOT_ENV.SECRET] = 'replace-me'
```

## Adapters

- [@tracehound/express](../express/README.md)
- [@tracehound/fastify](../fastify/README.md)

## Documentation

- [API Reference](../../docs/API.md)
- [Configuration](../../docs/CONFIGURATION.md)
- [Breaking Changes](../../docs/BREAKING-CHANGES.md)

## License

Apache-2.0
