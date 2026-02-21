![Tracehound](.github/assets/banner.png)

# Tracehound

**Deterministic Runtime Security Buffer for Modern Applications.**

Tracehound is a decision-free security buffer that quarantines threats detected by external systems (WAFs, SIEMs, or ML detectors). <br />
It acts as a forensic substrate, preserving tamper-evident evidence while ensuring production safety through fail-open semantics.

[![Advanced CodeQL Analysis](https://github.com/tracehound/tracehound/actions/workflows/codeql-advanced.yml/badge.svg)](https://github.com/tracehound/tracehound/actions/workflows/codeql-advanced.yml)
[![Semgrep Security Analysis](https://github.com/tracehound/tracehound/actions/workflows/semgrep.yml/badge.svg)](https://github.com/tracehound/tracehound/actions/workflows/semgrep.yml)
[![CodeQL](https://github.com/tracehound/tracehound/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/tracehound/tracehound/actions/workflows/github-code-scanning/codeql)
[![Dependabot Updates](https://github.com/tracehound/tracehound/actions/workflows/dependabot/dependabot-updates/badge.svg)](https://github.com/tracehound/tracehound/actions/workflows/dependabot/dependabot-updates)
[![CI](https://github.com/tracehound/tracehound/actions/workflows/ci.yml/badge.svg)](https://github.com/tracehound/tracehound/actions/workflows/ci.yml)
[![License: Apache2.0](https://img.shields.io/badge/License-Apache2.0-blue.svg)](https://opensource.org/license/apache-2-0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![npm](https://img.shields.io/npm/v/@tracehound/core.svg)](https://www.npmjs.com/package/@tracehound/core)

[Documentation](./docs/README.md) · [Security Audit](./security/readme.md) · [Report Bug](https://github.com/tracehound/tracehound/issues) · [Request Feature](https://github.com/tracehound/tracehound/issues)

---

## About the Project

Tracehound is a deterministic runtime security substrate. It doesn't use heuristics or "guess" if a request is malicious; instead, it acts as a high-integrity buffer for explicit security signals (Scents) from external detectors. By quarantining suspicious events and preserving them in a tamper-evident AuditChain, Tracehound ensures that security events are forever auditable without disrupting production traffic.

## Why we built this

Modern security architectures often face a trade-off between "blocking and breaking" or "logging and losing" forensic details. We built Tracehound to solve the gap between real-time traffic and backend security analysis:

- **Resilience**: Fail-open semantics ensure security tooling never becomes a self-imposed DoS vector.
- **Forensic Integrity**: Tamper-evident AuditChain provides an immutable record of what actually happened, solving the "log tampering" problem.
- **Decoupling**: By trusting external logic for detection, Tracehound remains a lightweight, stable, and deterministic buffer that stays out of the way of your application logic.

---

## Key Features

- **Deterministic Security Buffer**: No heuristics, no false positives. It only operates on explicit signals.
- **Decision-Free Architecture**: Trusts external detection logic, focusing on deterministic evidence handling and bounded ingestion safety.
- **Fail-Open Semantics**: Designed for high-velocity APIs where production availability is paramount.
- **AuditChain**: Merkle-chained, tamper-evident forensic logging of all security events.
- **Bounded Runtime Controls**: Size, queue, and timeout controls are enforced in core paths; performance envelope is deployment-dependent.
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
│  HoundPool     → Process-separated analysis   │
│  Scheduler     → Jittered background          │
│  Notifications → Universal events             │
│  SecurityState → Unified metrics              │
└───────────────────────────────────────────────┘
```

---

## Core Principles

1. **Decision-free**: Tracehound never decides if a request is malicious. It only acts on external decisions.
2. **Detection is external**: Use your existing WAF, SIEM, or ML engine to drive Tracehound.
3. **Forensics > Visualization**: Immutable evidence is our primary product, not pretty dashboards.
4. **Local-First**: Operates within your application runtime for low-latency interception and auditability.

---

## Documentation

- **[Getting Started](./docs/GETTING-STARTED.md)**
- **[Configuration Reference](./docs/CONFIGURATION.md)**
- [API Documentation](./docs/API.md)
- [Evidence Lifecycle](./docs/EVIDENCE-LIFECYCLE-POLICY.md)
- [Security Assurance & Chaos Testing](./docs/SECURITY-ASSURANCE.md)

---

## Community

- **[Contributing](./CONTRIBUTING.md)**: Establish clear pathways for contribution.
- **[Code of Conduct](./CODE_OF_CONDUCT.md)**: Maintain a professional and inclusive community.
- **[Security Policy](./SECURITY.md)**: Reporting vulnerabilities.

---

## RFCs (Request for Comments)

Tracehound development is driven by the RFC process. See the [docs/rfc](./docs/rfc) directory for all active and planned proposals.

---

## License

Tracehound is licensed under the [Apache-2.0 License](./LICENSE).
