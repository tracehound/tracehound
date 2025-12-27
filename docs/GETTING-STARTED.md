# Getting Started with Tracehound

> **Tracehound**: Deterministic runtime security buffer for FinTech applications

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
import {
  createAgent,
  createQuarantine,
  createRateLimiter,
  createEvidenceFactory,
  AuditChain,
} from '@tracehound/core'

// Initialize components
const auditChain = new AuditChain()
const quarantine = createQuarantine(
  { maxCount: 1000, maxBytes: 100_000_000, evictionPolicy: 'priority' },
  auditChain
)
const rateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 100,
  blockDurationMs: 300_000,
})
const evidenceFactory = createEvidenceFactory()

// Create agent
const agent = createAgent({ maxPayloadSize: 1_000_000 }, quarantine, rateLimiter, evidenceFactory)
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
import { createTracehoundMiddleware } from '@tracehound/express'

const middleware = createTracehoundMiddleware({
  maxPayloadSize: 1_000_000,
  quarantine: { maxCount: 1000 },
  rateLimit: { windowMs: 60_000, maxRequests: 100 },
  detector: (req) => externalDetector(req),
})

app.use(middleware)
```

### Fastify

```typescript
import { tracehoundPlugin } from '@tracehound/fastify'

fastify.register(tracehoundPlugin, {
  maxPayloadSize: 1_000_000,
  detector: (req) => externalDetector(req),
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

---

## Core Concepts

### Scent

The input data structure representing a request:

```typescript
interface Scent {
  id: string // Unique ID (UUIDv7)
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

- [Configuration Reference](./CONFIGURATION.md)
- [API Documentation](./API.md)
- [RFC-0000: Core Architecture](./rfc/0000-Proposal.md)

---

## License

Commercial (Enterprise / Premium)
