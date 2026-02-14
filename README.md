![Tracehound Banner](.github/assets/tracehound-banner.jpg)

# Tracehound

**Deterministic Runtime Security Buffer for Modern Applications.**

Tracehound is a decision-free security buffer that quarantines threats detected by external systems (WAFs, SIEMs, or ML detectors). It acts as a forensic substrate, preserving tamper-evident evidence while ensuring production safety through fail-open semantics.

---

## Key Features

- **Deterministic Security Buffer**: No heuristics, no false positives. It only operates on explicit signals.
- **Decision-Free Architecture**: Trusts external detection logic, focusing purely on isolation and evidence.
- **Fail-Open Semantics**: Designed for high-velocity APIs where production availability is paramount.
- **AuditChain**: Merkle-chained, tamper-evident forensic logging of all security events.
- **Bounded Memory & Performance**: Fixed memory overhead and sub-millisecond hot-path latency.
- **Cold Storage Adapters**: Automatic archival of evidence to S3, R2, or GCS.

---

## Ecosystem

Tracehound is a monorepo containing several specialized packages:

| Package                                       | Purpose                                                |
| :-------------------------------------------- | :----------------------------------------------------- |
| **[@tracehound/core](./packages/core)**       | The security substrate and runtime agent.              |
| **[@tracehound/express](./packages/express)** | Official Express middleware for zero-code integration. |
| **[@tracehound/fastify](./packages/fastify)** | Official Fastify plugin for high-performance APIs.     |
| **[@tracehound/cli](./packages/cli)**         | Evaluation runtime and forensic inspection tool.       |

---

## Quick Start

### Core Usage

```typescript
import { createTracehound } from '@tracehound/core'

const tracehound = createTracehound({
  quarantine: { maxCount: 1000 },
  rateLimit: { windowMs: 60000, maxRequests: 100 },
})

// Intercept a potential threat signal (Scent)
const result = tracehound.agent.intercept({
  id: 'unique-id',
  timestamp: Date.now(),
  source: '127.0.0.1',
  payload: { path: '/api/v1/user', method: 'POST' },
})

if (result.status === 'quarantined') {
  console.log('Threat quarantined. Signature:', result.handle.signature)
}
```

### Express Integration

```typescript
import express from 'express'
import { createTracehound } from '@tracehound/core'
import { tracehound } from '@tracehound/express'

const app = express()
const th = createTracehound()

// Mount the middleware
app.use(tracehound({ agent: th.agent }))

app.get('/', (req, res) => res.send('Protected by Tracehound'))
```

### Fastify Integration

```typescript
import fastify from 'fastify'
import { createTracehound } from '@tracehound/core'
import { tracehoundPlugin } from '@tracehound/fastify'

const app = fastify()
const th = createTracehound()

app.register(tracehoundPlugin, { agent: th.agent })
```

---

## Architecture

```
        External Detector (WAF, SIEM, ML)
                      │
                      ▼
┌───────────────────────────────────────────────┐
│                   TRACEHOUND                  │
├───────────────────────────────────────────────┤
│  Agent         → Traffic orchestrator         │
│  Quarantine    → Evidence buffer              │
│  AuditChain    → Tamper-evident log           │
│  HoundPool     → Sandboxed analysis           │
│  Scheduler     → Jittered background          │
│  Notifications → Universal events             │
│  SecurityState → Unified metrics              │
└───────────────────────────────────────────────┘
```

---

## Core Principles

1.  **Decision-free**: Tracehound never decides if a request is malicious. It only acts on external decisions.
2.  **Detection is external**: Use your existing WAF, SIEM, or ML engine to drive Tracehound.
3.  **Forensics > Visualization**: Immutable evidence is our primary product, not pretty dashboards.
4.  **Local-First**: Operates within your application runtime for maximum speed and security.

---

## Documentation

- **[Getting Started](./docs/GETTING-STARTED.md)**
- **[Configuration Reference](./docs/CONFIGURATION.md)**
- **[API Documentation](./docs/API.md)**
- **[Evidence Lifecycle](./docs/EVIDENCE-LIFECYCLE-POLICY.md)**

---

## RFCs (Request for Comments)

Tracehound development is driven by the RFC process. See the [docs/rfc](./docs/rfc) directory for all active and planned proposals.

---

## License

Tracehound is licensed under the [Apache-2.0 License](./LICENSE).
