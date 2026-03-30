# @tracehound/express

Thin Express middleware adapter for `@tracehound/core`.

The adapter does not perform threat detection. It maps `agent.intercept()` results to HTTP behavior and keeps fail-open semantics by default.

## Installation

```bash
pnpm add @tracehound/core @tracehound/express
# or
npm install @tracehound/core @tracehound/express
```

## Basic Usage

For deterministic signatures based on raw ingress bytes, populate `req.rawBody` before Tracehound middleware runs.

```ts
import { Buffer } from 'node:buffer'
import express from 'express'
import { createTracehound } from '@tracehound/core'
import { tracehound } from '@tracehound/express'

const app = express()
const th = createTracehound()

app.use(
  express.json({
    verify: (req, _res, buf) => {
      Reflect.set(req, 'rawBody', Buffer.from(buf))
    },
  }),
)

app.use(
  tracehound({
    agent: th.agent,
    maxPayloadSize: 1_000_000,
    emitTraceIdHeader: true,
    resolveSourceIp: (req) => req.socket.remoteAddress ?? req.ip ?? 'unknown',
  }),
)
```

## Options

| Option                    | Type                         | Required | Default            | Description                                                                 |
| ------------------------- | ---------------------------- | -------- | ------------------ | --------------------------------------------------------------------------- |
| `agent`                   | `IAgent`                     | Yes      | -                  | Tracehound Agent instance                                                   |
| `emitSignatureInResponse` | `boolean`                    | No       | `false`            | Include signature in `403` body                                             |
| `emitTraceIdHeader`       | `boolean`                    | No       | `false`            | Emit `x-tracehound-trace-id` on quarantined responses                       |
| `maxPayloadSize`          | `number`                     | No       | unset              | Skip unsafe body clone work when `Content-Length` already exceeds the limit |
| `resolveSourceIp`         | `(req: Request) => string`   | No       | internal resolver  | Override `req.ip` when proxy/CDN trust settings should not be relied on     |
| `extractScent`            | `(req: Request) => Scent`    | No       | internal extractor | Override Scent extraction                                                   |
| `onIntercept`             | `(result, req, res) => void` | No       | internal handler   | Override response behavior                                                  |

## Default Status Mapping

| Intercept status    | HTTP behavior           |
| ------------------- | ----------------------- |
| `clean`             | pass through (`next()`) |
| `ignored`           | pass through (`next()`) |
| `rate_limited`      | `429` + `Retry-After`   |
| `payload_too_large` | `413`                   |
| `quarantined`       | `403`                   |
| `error`             | fail-open pass through  |

## onIntercept Pattern

Use custom `onIntercept` only when your route contract is explicit.

```ts
app.use(
  tracehound({
    agent: th.agent,
    onIntercept(result, req, res) {
      if (result.status === 'error' && req.accepts('json') && !res.headersSent) {
        res.status(200).json({
          ok: true,
          tracehound: {
            degraded: true,
            code: result.error.code,
          },
        })
      }
    },
  }),
)
```

## Deterministic Signature Notes

- Adapter only reads `req.rawBody` for `ingressBytes`
- It does not fall back to `req.body` for raw-byte signatures
- Without `rawBody`, signatures come from canonicalized payload
- `maxPayloadSize` is a memory-safety guard for clone avoidance, not the hard enforcement point; the agent still enforces the actual payload limit
- `resolveSourceIp` is strongly recommended behind a proxy or CDN when `req.ip` trust settings are not fully under your control

## Custom Scent Notes

If you override `extractScent`, keep the structured `Scent.source` contract:

```ts
source: {
  ip: '203.0.113.10',
  userAgent: req.get('user-agent'),
  tls: {
    cipherSuite: 'TLS_AES_256_GCM_SHA384',
    version: 'TLSv1.3',
  },
}
```

Tracehound does not detect threats in the adapter. Custom extraction should only normalize upstream threat signals into the canonical `threat` object.

## Exports

- `tracehound(options)`
- `createMiddleware` (alias)
- types re-export: `Scent`, `InterceptResult`

## Further Reading

- [Configuration](../../docs/CONFIGURATION.md)
- [API Reference](../../docs/API.md)
- [Supply Chain & Release Boundary](../../security/supply-chain.md)

## License

Apache-2.0
