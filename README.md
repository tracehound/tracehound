# Tracehound

![Tracehound Banner](.github/assets/tracehound-banner.jpg)

**Cyberimmune System for Modern Applications.**

> Tracehound is a deterministic, observable system for threat quarantine and analysis.
> It acts as a security buffer layer between traffic intake and business logic.

## Project Structure

This monorepo contains the following packages:

- **[`@tracehound/core`](./packages/core)**: The core logic engine. Contains Agent, Quarantine, HoundPool, and Watcher.

## Architecture

Tracehound follows a component-based architecture designed for high throughput and resilience:

- **Agent:** Traffic cop and orchestrator.
- **Quarantine:** Secure buffer for suspicious payloads.
- **Hound Pool:** Sandboxed processes for forensic analysis.
- **Watcher:** Observability engine (pull-based).
- **Audit Chain:** Tamper-evident logging.

## Core Principles

1. **Determinism:** No black-box ML magic in the hot path. All decisions are explainable.
2. **Resilience:** "Correctness is secondary to survivability." The system degrades gracefully under load.
3. **Observability:** Internal state is fully observable via snapshots.

## RFCs

- [RFC-0001: Working Memory](./docs/rfc/0001-WorkingMemory.md) - Accepted
- [RFC-0002: Argos & Behavioral Signal Protocol](./docs/rfc/0002-Argos.md) - Draft

## License

MIT
