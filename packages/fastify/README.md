# @tracehound/fastify

Fastify plugin for Tracehound security buffer.

## Breaking Change Notice

Default export has been removed. Use named export only.

### Before

```ts
import tracehoundPlugin from '@tracehound/fastify'
```

### After

```ts
import { tracehoundPlugin } from '@tracehound/fastify'
```

## Installation

```bash
npm install @tracehound/fastify @tracehound/core
```

## Usage

```ts
import fastify from 'fastify'
import { tracehoundPlugin } from '@tracehound/fastify'
import { createTracehound } from '@tracehound/core'

const app = fastify()

// Create Tracehound instance
const th = createTracehound({
  quarantine: { maxCount: 10000, maxBytes: 100_000_000 },
  rateLimit: { windowMs: 60_000, maxRequests: 100 },
})

// Register plugin
app.register(tracehoundPlugin, { agent: th.agent })

app.get('/', async (req, reply) => {
  return { message: 'Protected by Tracehound' }
})

app.listen({ port: 3000 })
```

## Options

| Option                    | Type                           | Required | Description                                        |
| ------------------------- | ------------------------------ | -------- | -------------------------------------------------- |
| `agent`                   | `IAgent`                       | Yes      | Tracehound Agent instance                          |
| `emitSignatureInResponse` | `boolean`                      | No       | If true, returns signature in 403 (default: false) |
| `extractScent`            | `(req) => Scent`               | No       | Custom scent extraction                            |
| `onIntercept`             | `(result, req, reply) => void` | No       | Custom response handler                            |

## Response Codes

| Result              | HTTP Status       |
| ------------------- | ----------------- |
| `clean`             | Pass through      |
| `rate_limited`      | 429 + Retry-After |
| `payload_too_large` | 413               |
| `quarantined`       | 403               |
| `error`             | Pass through by default |

`onIntercept` can still emit a custom response for `error` results if you need framework-specific handling.

## `onIntercept` Pattern

Use `onIntercept` only when the host application explicitly owns the response contract for that route.

```ts
app.register(tracehoundPlugin, {
  agent: th.agent,
  onIntercept(result, req, reply) {
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

Guidelines:

1. Keep the default fail-open path for routes whose response shape you do not own.
2. Only emit a structured fallback when the endpoint already guarantees that response format.
3. Do not override streams, file downloads, redirects, or HTML responses.
4. Prefer server-side logging and notification handling for operator visibility.

## License

MIT
