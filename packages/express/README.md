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
| `error`             | 500               |

## License

MIT
