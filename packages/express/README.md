# @tracehound/express

Express middleware for Tracehound security buffer.

## Installation

```bash
npm install @tracehound/express @tracehound/core
```

## Usage

```ts
import express from 'express'
import { tracehound } from '@tracehound/express'
import { createTracehound } from '@tracehound/core'

const app = express()

// Create Tracehound instance
const th = createTracehound({
  quarantine: { maxCount: 10000, maxBytes: 100_000_000 },
  rateLimit: { windowMs: 60_000, maxRequests: 100 },
})

// Apply middleware
app.use(express.json())
app.use(tracehound({ agent: th.agent }))

app.get('/', (req, res) => {
  res.json({ message: 'Protected by Tracehound' })
})

app.listen(3000)
```

## Options

| Option                    | Type                         | Required | Description                                        |
| ------------------------- | ---------------------------- | -------- | -------------------------------------------------- |
| `agent`                   | `IAgent`                     | Yes      | Tracehound Agent instance                          |
| `emitSignatureInResponse` | `boolean`                    | No       | If true, returns signature in 403 (default: false) |
| `extractScent`            | `(req) => Scent`             | No       | Custom scent extraction                            |
| `onIntercept`             | `(result, req, res) => void` | No       | Custom response handler                            |

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

Guidelines:

1. Keep the default fail-open path for routes whose response shape you do not own.
2. Only emit a JSON fallback when the endpoint already guarantees a JSON contract.
3. Do not override streams, file downloads, redirects, or HTML responses.
4. Prefer server-side logging and notification handling for operator visibility.

## License

Apache-2.0
