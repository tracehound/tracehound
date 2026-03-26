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
    emitTraceIdHeader: true,
  }),
)
```

## Options

| Option                    | Type                         | Required | Default            | Description                                           |
| ------------------------- | ---------------------------- | -------- | ------------------ | ----------------------------------------------------- |
| `agent`                   | `IAgent`                     | Yes      | -                  | Tracehound Agent instance                             |
| `emitSignatureInResponse` | `boolean`                    | No       | `false`            | Include signature in `403` body                       |
| `emitTraceIdHeader`       | `boolean`                    | No       | `false`            | Emit `x-tracehound-trace-id` on quarantined responses |
| `extractScent`            | `(req: Request) => Scent`    | No       | internal extractor | Override Scent extraction                             |
| `onIntercept`             | `(result, req, res) => void` | No       | internal handler   | Override response behavior                            |

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

## Exports

- `tracehound(options)`
- `createMiddleware` (alias)
- types re-export: `Scent`, `InterceptResult`

## License

Apache-2.0
