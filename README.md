# Tracehound

![Tracehound Banner](.github/assets/tracehound-banner.jpg)

**Deterministic Runtime Security Buffer for Modern Applications.**

> Tracehound is a decision-free security buffer that quarantines threats detected by external systems.
> It acts as a forensic substrate between traffic intake and business logic.

## Documentation

- **[Getting Started](./docs/GETTING-STARTED.md)** - Installation and quick start
- **[Configuration Reference](./docs/CONFIGURATION.md)** - All configuration options
- **[API Documentation](./docs/API.md)** - Complete API reference

## Project Structure

This monorepo contains the following packages:

- **[`@tracehound/core`](./packages/core)**: The core logic engine
- **[`@tracehound/express`](./packages/express)**: Express adapter
- **[`@tracehound/fastify`](./packages/fastify)**: Fastify adapter
- **[`@tracehound/cli`](./packages/cli)**: CLI and TUI dashboard

## Architecture

```
External Detector (WAF, SIEM, ML)
          │
          ▼
┌─────────────────────────────────────┐
│            TRACEHOUND               │
├─────────────────────────────────────┤
│  Agent      → Traffic orchestrator  │
│  Quarantine → Evidence buffer       │
│  AuditChain → Tamper-evident log    │
│  HoundPool  → Sandboxed analysis    │
│  Watcher    → Pull-based metrics    │
└─────────────────────────────────────┘
```

## Core Principles

1. **Decision-Free:** Tracehound does NOT detect threats. External detectors do.
2. **Deterministic:** No ML in hot path. All behavior is explainable.
3. **Payload-Less:** No raw payload exposure outside quarantine.
4. **GC-Independent:** Explicit lifecycle management.

## RFCs

- [RFC-0000: Core Architecture](./docs/rfc/0000-Proposal.md) - Locked
- [RFC-0001: SecurityState](./docs/rfc/0001-SecurityState.md) - Accepted
- [RFC-0002: Argos](./docs/rfc/0002-Argos.md) - Draft
- [RFC-0003: ThreatLedger](./docs/rfc/0003-ThreatLedger.md) - Draft
- [RFC-0004: ResponseEngine](./docs/rfc/0004-ResponseEngine.md) - Draft
- [RFC-0005: ThreatIntel](./docs/rfc/0005-ThreatIntel.md) - Draft

## License

Commercial (Enterprise / Premium)
