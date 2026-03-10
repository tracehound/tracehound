![Tracehound](.github/assets/tracehound-banner.jpg)

<div align="center">

**Deterministic runtime security buffer for high-velocity APIs**

**External systems signal threats. Tracehound preserves evidence.**

[![Advanced CodeQL Analysis](https://github.com/tracehound/tracehound/actions/workflows/codeql-advanced.yml/badge.svg?branch=main)](https://github.com/tracehound/tracehound/actions/workflows/codeql-advanced.yml)
[![Semgrep Security Analysis](https://github.com/tracehound/tracehound/actions/workflows/semgrep.yml/badge.svg)](https://github.com/tracehound/tracehound/actions/workflows/semgrep.yml)
[![Paranoid Validation](https://github.com/tracehound/tracehound/actions/workflows/security-paranoid.yml/badge.svg?branch=main)](https://github.com/tracehound/tracehound/actions/workflows/security-paranoid.yml)
[![CodeCov](https://codecov.io/github/tracehound/tracehound/tree/main/badge.svg)](https://app.codecov.io/github/tracehound/tracehound/tree/main)
[![OpenSSF Scorecard](https://github.com/tracehound/tracehound/actions/workflows/scorecard.yml/badge.svg)](https://github.com/tracehound/tracehound/actions/workflows/scorecard.yml)
[![License: Apache2.0](https://img.shields.io/badge/License-Apache2.0-blue.svg)](https://opensource.org/license/apache-2-0)
[![npm](https://img.shields.io/npm/v/@tracehound/core.svg)](https://www.npmjs.com/package/@tracehound/core)

[Website](https://tracehoundlabs.com) · [Documentation Index](./docs/README.md) · [API Reference](./docs/API.md) · [Configuration](./docs/CONFIGURATION.md) · [RFCs](./docs/rfc/README.md) · [Security](./security/readme.md) · [Changelog](./CHANGELOG.md)

</div>

Tracehound is a decision-free forensic runtime that sits between upstream detection and downstream response. It does not classify traffic, apply heuristics, or replace a WAF. It receives explicit threat signals, quarantines evidence, and preserves a tamper-evident operational record without becoming a new denial-of-service vector for the host application.

WAFs are one possible upstream authority, not the product boundary. Tracehound’s evidence path can be driven by any explicit external threat signal source that can be mapped into `scent.threat`, including reverse proxies, bot-management systems, abuse detectors, and internal risk services, while native guardrails such as rate limiting and payload-size controls continue to operate independently.

This repository contains the open-source Tracehound substrate: `@tracehound/core`, `@tracehound/express`, `@tracehound/fastify`, and `@tracehound/cli`. Current work is centered on real-world OSS validation, deployment confidence, and operator usability.

## What Tracehound Guarantees

- **Decision-free runtime**: Tracehound never decides whether traffic is malicious. Upstream systems provide the threat signal.
- **Deterministic behavior**: No ML, heuristics, or probabilistic branching in the hot path.
- **Fail-open host safety**: Runtime faults do not turn Tracehound into an application-layer DoS vector.
- **Payload-less runtime membrane**: Raw payload bytes stay inside the quarantine boundary; runtime code receives metadata-only handles.
- **Tamper-evident custody**: Evidence lifecycle events are recorded through `AuditChain`.
- **Bounded resource use**: Quarantine, rate limiting, notification delivery, hound queues, and decay workflows have explicit caps.

## What Tracehound Is Not

- Not a WAF, IDS, SIEM, RASP, or threat classifier
- Not an APM or request analytics platform
- Not a policy engine or access-control layer
- Not a payload-inspection service for runtime application code

## Runtime Model

```text
Request/Event
  -> Adapter extracts Scent
  -> agent.intercept(scent)
     -> rate_limited        (429)
     -> clean               (pass through)
     -> payload_too_large   (413)
     -> ignored             (duplicate signature, pass through)
     -> quarantined         (403, metadata-only runtime handle)
     -> error               (fail-open)
```

### Intercept Statuses

| Status              | Meaning                                                  | Default adapter behavior          |
| :------------------ | :------------------------------------------------------- | :-------------------------------- |
| `clean`             | No threat signal on the `Scent`                          | Pass through                      |
| `rate_limited`      | Source exceeded bounded sliding-window limits            | HTTP `429` + `Retry-After`        |
| `payload_too_large` | Payload exceeded `maxPayloadSize`                        | HTTP `413`                        |
| `ignored`           | Duplicate signature or deterministic drop under pressure | Pass through                      |
| `quarantined`       | Evidence stored successfully                             | HTTP `403`                        |
| `error`             | Internal Tracehound failure                              | Fail-open pass through by default |

## Repository Scope

| Package                                     | Role                                                                                            |
| :------------------------------------------ | :---------------------------------------------------------------------------------------------- |
| [`@tracehound/core`](./packages/core)       | Security engine, evidence lifecycle, quarantine, AuditChain, watcher, hound pool, notifications |
| [`@tracehound/express`](./packages/express) | Thin Express middleware adapter                                                                 |
| [`@tracehound/fastify`](./packages/fastify) | Thin Fastify plugin adapter                                                                     |
| [`@tracehound/cli`](./packages/cli)         | CLI and terminal inspection tooling                                                             |

## Installation

```bash
pnpm add @tracehound/core
pnpm add @tracehound/core @tracehound/express
pnpm add @tracehound/core @tracehound/fastify
pnpm add -g @tracehound/cli
```

Requirements:

- Node.js `>=20`
- `pnpm` workspace tooling for repository development

## Quick Start

```ts
import { createTracehound, generateSecureId, type Scent } from '@tracehound/core'

const th = createTracehound({
  maxPayloadSize: 1_000_000,
  quarantine: {
    maxCount: 10_000,
    maxBytes: 100_000_000,
  },
  rateLimit: {
    windowMs: 60_000,
    maxRequests: 100,
  },
})

const scent: Scent = {
  id: generateSecureId(),
  timestamp: Date.now(),
  source: {
    ip: '203.0.113.10',
    userAgent: 'curl/8.7.1',
  },
  payload: {
    method: 'POST',
    path: '/api/login',
    body: { username: 'alice' },
  },
  threat: {
    category: 'injection',
    severity: 'high',
  },
}

const result = th.agent.intercept(scent)

if (result.status === 'quarantined') {
  console.log(result.handle.signature)
  console.log(result.handle.membrane) // metadata_only
}

th.shutdown()
```

Notes:

- `Scent.source` is a structured object: `{ ip, userAgent?, tls? }`
- `Scent.payload` must be JSON-serializable
- If `ingressBytes` is present, Tracehound hashes raw ingress bytes instead of canonicalized payload bytes

## Framework Adapters

### Express

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

### Fastify

```ts
import fastify from 'fastify'
import { createTracehound } from '@tracehound/core'
import { tracehoundPlugin } from '@tracehound/fastify'

const app = fastify()
const th = createTracehound()

app.register(tracehoundPlugin, {
  agent: th.agent,
  emitTraceIdHeader: true,
})
```

Adapter notes:

- Express and Fastify adapters are intentionally thin and carry no security decision logic
- For deterministic ingress-byte signatures, set `rawBody` before Tracehound runs
- `emitTraceIdHeader` is optional and enables `x-tracehound-trace-id` for local inspection workflows
- `@tracehound/fastify` uses the named export `tracehoundPlugin`

## CLI and Operational Snapshots

Tracehound CLI provides runtime status, stats, live watch output, and local trace inspection workflows.

```bash
tracehound status
tracehound stats
tracehound inspect --trace-id <trace-id>
tracehound watch
tracehound history clear
tracehound disk clear
```

`status`, `stats`, and `watch` require a signed runtime snapshot. Configure snapshot export in the application runtime:

```ts
import { createTracehound } from '@tracehound/core'

const th = createTracehound({
  snapshot: {
    path: '/var/run/tracehound/system-snapshot.json',
    secret: process.env.TRACEHOUND_SNAPSHOT_SECRET,
    intervalMs: 1000,
  },
})
```

```bash
export TRACEHOUND_SYSTEM_SNAPSHOT_PATH=/var/run/tracehound/system-snapshot.json
export TRACEHOUND_SNAPSHOT_SECRET=replace-me
export TRACEHOUND_SNAPSHOT_MAX_AGE_MS=5000
export TRACEHOUND_SNAPSHOT_MAX_FUTURE_SKEW_MS=5000
```

If snapshot input is missing, stale, tampered, or unverifiable, CLI commands fail explicitly instead of fabricating healthy runtime state.

## Documentation Map

| Area                    | Document                                                         |
| :---------------------- | :--------------------------------------------------------------- |
| Onboarding              | [Getting Started](./docs/GETTING-STARTED.md)                     |
| API surface             | [API Reference](./docs/API.md)                                   |
| Runtime options         | [Configuration Reference](./docs/CONFIGURATION.md)               |
| Upgrade path            | [Breaking Changes](./docs/BREAKING-CHANGES.md)                   |
| Evidence custody        | [Evidence Lifecycle Policy](./docs/EVIDENCE-LIFECYCLE-POLICY.md) |
| Fail-open behavior      | [Fail-Open Spec](./docs/FAIL-OPEN-SPEC.md)                       |
| Performance envelope    | [Performance SLA](./docs/PERFORMANCE-SLA.md)                     |
| Security validation     | [Security Assurance](./docs/SECURITY-ASSURANCE.md)               |
| Architecture governance | [RFC Index](./docs/rfc/README.md)                                |
| Security review corpus  | [Security Readme](./security/readme.md)                          |

## Development

```bash
pnpm build
pnpm test
pnpm test:coverage
pnpm lint
pnpm validate:paranoid
```

Per-package examples:

```bash
pnpm --filter @tracehound/core test
pnpm --filter @tracehound/express test
pnpm --filter @tracehound/fastify test
pnpm --filter @tracehound/cli test
```

## Contributing and Security

- [Contributing Guide](./CONTRIBUTING.md)
- [Security Policy](./SECURITY.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)

## License

Tracehound is licensed under the [Apache-2.0 License](./LICENSE).
