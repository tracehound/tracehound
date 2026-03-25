# Getting Started with Tracehound

> **Tracehound**: Deterministic runtime security buffer for applications

## What is Tracehound?

Tracehound is a **decision-free security buffer** that:

- Quarantines threats detected by external systems (WAF, SIEM, custom rules)
- Preserves evidence with cryptographic integrity
- Provides audit chain for compliance
- Operates without making security decisions itself

**Tracehound does NOT:**

- Detect threats (external detectors do this)
- Make policy decisions
- Inspect payload contents
- Replace WAF/RASP systems

---

## Architecture Overview

```
External Detector (WAF, ML, Rules)
          │
          │ Threat Signal
          ▼
┌─────────────────────────────────────────────────┐
│                  TRACEHOUND                     │
│  ┌──────────────────────────────────────────┐  │
│  │ AGENT                                     │  │
│  │ intercept(request) → InterceptResult      │  │
│  └───────────────┬──────────────────────────┘  │
│                  │                              │
│  ┌───────────────▼──────────────────────────┐  │
│  │ QUARANTINE                                │  │
│  │ Evidence storage + Audit chain            │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

---

## Installation

```bash
# Using pnpm (recommended)
pnpm add @tracehound/core

# Using npm
npm install @tracehound/core
```

---

## Quick Start

### 1. Create Tracehound Instance

```typescript
import { createTracehound } from '@tracehound/core'

// Initialize Tracehound
const th = createTracehound({
  maxPayloadSize: 1_000_000,
  quarantine: {
    maxCount: 1000,
    maxBytes: 100_000_000,
  },
  rateLimit: {
    windowMs: 60_000,
    maxRequests: 100,
    blockDurationMs: 300_000,
  },
})

// Access components
const agent = th.agent
```

### 2. Intercept Requests

```typescript
import type { Scent } from '@tracehound/core'

// Your external detector determines if this is a threat
const externalDetector = (req: Request): ThreatSignal | undefined => {
  // WAF, ML model, regex rules, etc.
  if (isSuspicious(req)) {
    return { category: 'injection', severity: 'high' }
  }
  return undefined
}

// Create scent from request
function createScent(req: Request): Scent {
  const threat = externalDetector(req)

  return {
    id: generateSecureId(),
    timestamp: Date.now(),
    source: req.ip,
    payload: {
      method: req.method,
      path: req.path,
      body: req.body,
    },
    threat, // undefined for clean requests
  }
}

// Intercept
app.use((req, res, next) => {
  const scent = createScent(req)
  const result = agent.intercept(scent)

  switch (result.status) {
    case 'clean':
      next() // Proceed normally
      break
    case 'quarantined':
      res.status(403).json({ error: 'Request quarantined' })
      break
    case 'rate_limited':
      res.status(429).json({
        error: 'Too many requests',
        retryAfter: result.retryAfter,
      })
      break
    case 'ignored':
      // Duplicate threat, already quarantined
      res.status(403).json({ error: 'Request blocked' })
      break
  }
})
```

---

## Framework Adapters

### Express

```typescript
import { createTracehound } from '@tracehound/core'
import { tracehound } from '@tracehound/express'

// Configure Tracehound first
const th = createTracehound({
  maxPayloadSize: 1_000_000,
  quarantine: { maxCount: 1000 },
  rateLimit: { windowMs: 60_000, maxRequests: 100 },
})

// Pass the agent to the middleware
app.use(
  tracehound({
    agent: th.agent,
    extractScent: (req) => customExtraction(req), // Optional: custom logic
  }),
)
```

### Fastify

```typescript
import { createTracehound } from '@tracehound/core'
import { tracehoundPlugin } from '@tracehound/fastify'

// Configure Tracehound first
const th = createTracehound({
  maxPayloadSize: 1_000_000,
})

// Register the plugin with the agent
fastify.register(tracehoundPlugin, {
  agent: th.agent,
  extractScent: (req) => customExtraction(req), // Optional: custom logic
})
```

---

## CLI Tool

```bash
# Install CLI
pnpm add @tracehound/cli

# Commands
tracehound status    # System status
tracehound stats     # Threat statistics
tracehound inspect   # Quarantine contents
tracehound watch     # Live TUI dashboard
```

CLI `status/stats/watch` commands require a signed runtime snapshot.
If snapshot input is missing or unverifiable, commands return explicit `NO_INSTANCE` / `INTEGRITY_VIOLATION` states.
`NO_INSTANCE` is also returned when the snapshot is stale (older than freshness window).

```bash
export TRACEHOUND_SYSTEM_SNAPSHOT_PATH=/var/run/tracehound/system-snapshot.json
export TRACEHOUND_SNAPSHOT_SECRET=your-shared-secret
# Optional: freshness window override (default 5000ms)
export TRACEHOUND_SNAPSHOT_MAX_AGE_MS=5000
# Optional: future timestamp tolerance (default 5000ms)
export TRACEHOUND_SNAPSHOT_MAX_FUTURE_SKEW_MS=5000
```

You can reference these keys programmatically instead of hard-coding strings:

```ts
import { SYSTEM_SNAPSHOT_ENV } from '@tracehound/core'

process.env[SYSTEM_SNAPSHOT_ENV.PATH] = '/var/run/tracehound/system-snapshot.json'
process.env[SYSTEM_SNAPSHOT_ENV.SECRET] = 'your-shared-secret'
process.env[SYSTEM_SNAPSHOT_ENV.MAX_AGE_MS] = '5000'
process.env[SYSTEM_SNAPSHOT_ENV.MAX_FUTURE_SKEW_MS] = '5000'
```

---

## Core Concepts

### Scent

The input data structure representing a request:

```typescript
interface Scent {
  id: string // Unique ID (crypto.randomUUID)
  timestamp: number // Unix timestamp
  source: string // Client IP or identifier
  payload: unknown // Request data
  threat?: ThreatSignal // External detection result
}
```

### ThreatSignal

Signal from external detector:

```typescript
interface ThreatSignal {
  category: string // e.g., 'injection', 'ddos'
  severity: 'critical' | 'high' | 'medium' | 'low'
  confidence?: number // 0-1
  metadata?: Record<string, unknown>
}
```

### InterceptResult

Result from `agent.intercept()`:

```typescript
type InterceptResult =
  | { status: 'clean' }
  | { status: 'quarantined'; handle: EvidenceHandle }
  | { status: 'rate_limited'; retryAfter: number }
  | { status: 'ignored'; reason: string }
```

---

## Next Steps

- [API & Configuration Reference](./API.md)
- [RFC-0000: Core Architecture](./rfc/0000-Proposal.md)

---

## License

Apache 2.0 (Substrate). See [LICENSE](../LICENSE)

```

```
