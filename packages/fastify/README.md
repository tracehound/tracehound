# @tracehound/fastify

Thin Fastify plugin adapter for `@tracehound/core`.

The plugin does not perform threat detection. It maps `agent.intercept()` results to HTTP behavior and keeps fail-open semantics by default.

## Installation

```bash
pnpm add @tracehound/core @tracehound/fastify
# or
npm install @tracehound/core @tracehound/fastify
```

## Basic Usage

```ts
import fastify from 'fastify'
import { createTracehound } from '@tracehound/core'
import { tracehoundPlugin } from '@tracehound/fastify'

const app = fastify()
const th = createTracehound()

app.register(tracehoundPlugin, {
  agent: th.agent,
  maxPayloadSize: 1_000_000,
  emitTraceIdHeader: true,
  resolveSourceIp: (req) => req.raw.socket.remoteAddress ?? req.ip ?? 'unknown',
})
```

## rawBody Requirement

For deterministic signatures based on ingress bytes, ensure `req.rawBody` exists before Tracehound hook execution.

Example using `@fastify/raw-body`:

```ts
import rawBody from '@fastify/raw-body'

await app.register(rawBody, {
  field: 'rawBody',
  global: true,
  encoding: false,
  runFirst: true,
})
```

If `rawBody` is absent, signatures are generated from canonicalized payload.

- `maxPayloadSize` is a memory-safety guard for clone avoidance, not the hard enforcement point; the agent still enforces the actual payload limit
- `resolveSourceIp` is strongly recommended behind a proxy or CDN when `req.ip` trust settings are not fully under your control

## Options

| Option                    | Type                              | Required | Default            | Description                                                                 |
| ------------------------- | --------------------------------- | -------- | ------------------ | --------------------------------------------------------------------------- |
| `agent`                   | `IAgent`                          | Yes      | -                  | Tracehound Agent instance                                                   |
| `emitSignatureInResponse` | `boolean`                         | No       | `false`            | Include signature in `403` body                                             |
| `emitTraceIdHeader`       | `boolean`                         | No       | `false`            | Emit `x-tracehound-trace-id` on quarantined responses                       |
| `maxPayloadSize`          | `number`                          | No       | unset              | Skip unsafe body clone work when `Content-Length` already exceeds the limit |
| `resolveSourceIp`         | `(req: FastifyRequest) => string` | No       | internal resolver  | Override `req.ip` when proxy/CDN trust settings should not be relied on     |
| `extractScent`            | `(req: FastifyRequest) => Scent`  | No       | internal extractor | Override Scent extraction                                                   |
| `onIntercept`             | `(result, req, reply) => void`    | No       | internal handler   | Override response behavior                                                  |

## Default Status Mapping

| Intercept status    | HTTP behavior               |
| ------------------- | --------------------------- |
| `clean`             | pass through (`hookDone()`) |
| `ignored`           | pass through (`hookDone()`) |
| `rate_limited`      | `429` + `Retry-After`       |
| `payload_too_large` | `413`                       |
| `quarantined`       | `403`                       |
| `error`             | fail-open pass through      |

## onIntercept Pattern

Use custom `onIntercept` only when your response contract is explicit.

```ts
app.register(tracehoundPlugin, {
  agent: th.agent,
  onIntercept(result, _req, reply) {
    if (result.status === 'error' && !reply.sent) {
      reply.status(200).send({
        ok: true,
        tracehound: {
          degraded: true,
          code: result.error.code,
        },
      })
    }
  },
})
```

## Exports

- `tracehoundPlugin`
- `createPlugin` (alias)
- types re-export: `Scent`, `InterceptResult`

## Custom Scent Notes

If you override `extractScent`, keep the structured `Scent.source` contract:

```ts
source: {
  ip: '203.0.113.10',
  userAgent: req.headers['user-agent'],
  tls: {
    cipherSuite: 'TLS_AES_256_GCM_SHA384',
    version: 'TLSv1.3',
  },
}
```

Tracehound does not detect threats in the plugin. Custom extraction should only normalize upstream threat signals into the canonical `threat` object.

## Further Reading

- [Configuration](../../docs/CONFIGURATION.md)
- [API Reference](../../docs/API.md)
- [Supply Chain & Release Boundary](../../security/supply-chain.md)

## License

Apache-2.0
