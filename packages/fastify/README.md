# @tracehound/fastify

Fastify plugin for Tracehound security buffer.

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
| `error`             | 500               |

## License

MIT
