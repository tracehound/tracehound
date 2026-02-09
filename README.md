# Tracehound

![Tracehound Banner](.github/assets/tracehound-banner.jpg)

**Deterministic Runtime Security Buffer for Modern Applications.**

> Tracehound is a decision-free security buffer that quarantines threats detected by external systems.
> It acts as a forensic substrate between traffic intake and business logic.

## Documentation

- **[Getting Started](./docs/GETTING-STARTED.md)** - Installation and quick start
- **[Configuration Reference](./docs/CONFIGURATION.md)** - All configuration options
- **[API Documentation](./docs/API.md)** - Complete API reference
- **[Roadmap](./docs/ROADMAP.md)** - Development phases and timeline

## Installation

```bash
npm install @tracehound/core
# or
pnpm add @tracehound/core
```

## Quick Start

```typescript
import { createTracehound } from '@tracehound/core'

const tracehound = createTracehound({
  licenseKey: process.env.TRACEHOUND_LICENSE_KEY,
})

// Intercept requests
const result = tracehound.agent.intercept(scent)

// Subscribe to events
tracehound.notifications.on('threat.detected', (event) => {
  console.log(`Threat: ${event.payload.category}`)
})

// Get security snapshot
const snapshot = tracehound.securityState?.snapshot()
```

## Architecture

```
External Detector (WAF, SIEM, ML)
          │
          ▼
┌─────────────────────────────────────┐
│            TRACEHOUND               │
├─────────────────────────────────────┤
│  Agent         → Traffic orchestrator│
│  Quarantine    → Evidence buffer     │
│  AuditChain    → Tamper-evident log  │
│  HoundPool     → Sandboxed analysis  │
│  Scheduler     → Jittered background │
│  Notifications → Universal events    │
│  SecurityState → Unified metrics     │
└─────────────────────────────────────┘
```

## Core Principles

1. **Decision-Free:** Tracehound does NOT detect threats. External detectors do.
2. **Deterministic:** No ML in hot path. All behavior is explainable.
3. **Payload-Less:** No raw payload exposure outside quarantine.
4. **GC-Independent:** Explicit lifecycle management.

## Project Structure

- **[`@tracehound/core`](./packages/core)**: The core logic engine
- **[`@tracehound/express`](./packages/express)**: Express adapter
- **[`@tracehound/fastify`](./packages/fastify)**: Fastify adapter
- **[`@tracehound/cli`](./packages/cli)**: CLI and TUI dashboard

## RFCs

- [RFC-0000: Core Architecture](./docs/rfc/0000-Proposal.md) - Locked
- [RFC-0001: Core SecurityState](./docs/rfc/0001-SecurityState.md) - ✅ Implemented
- [RFC-0002: Argos](./docs/rfc/0002-Argos.md) - Draft
- [RFC-0003: Talos](./docs/rfc/0003-Talos.md) - Draft
- [RFC-0004: Muninn](./docs/rfc/0004-Muninn.md) - Draft
- [RFC-0005: Huginn](./docs/rfc/0005-Huginn.md) - Draft
- [RFC-0006: Heimdall](./docs/rfc/0006-Heimdall.md) - Draft
- [RFC-0007: Loki](./docs/rfc/0007-Loki.md) - Draft
- [RFC-0008: Rust Core Pivot](./docs/rfc/0008-RustCorePivot.md) - Draft

## License

Open-Core (Substrate: OSS, Satellites: Commercial). See [PRICING.md](./docs/PRICING.md).
