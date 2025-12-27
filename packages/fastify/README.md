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
import { createAgent, createQuarantine, createRateLimiter } from '@tracehound/core'

const app = fastify()

// Create Tracehound components
const quarantine = createQuarantine({ maxCount: 10000, maxBytes: 100_000_000 })
const rateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 100 })
const agent = createAgent({ quarantine, rateLimiter })

// Register plugin
app.register(tracehoundPlugin, { agent })

app.get('/', async (req, reply) => {
  return { message: 'Protected by Tracehound' }
})

app.listen({ port: 3000 })
```

## Options

| Option         | Type                           | Required | Description               |
| -------------- | ------------------------------ | -------- | ------------------------- |
| `agent`        | `IAgent`                       | Yes      | Tracehound Agent instance |
| `extractScent` | `(req) => Scent`               | No       | Custom scent extraction   |
| `onIntercept`  | `(result, req, reply) => void` | No       | Custom response handler   |

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
