# Tracehound Pricing Model

> **Model:** Open-Core + Paid Satellites
> **Core Principle:** Monetize capability, not safety.

---

## Architecture Layers

| Layer          | Access           | Packages                                | Purpose                                            |
| -------------- | ---------------- | --------------------------------------- | -------------------------------------------------- |
| **Substrate**  | Open Source      | @tracehound/core, express, fastify, cli | Deterministic evidence, interception, containment. |
| **Satellites** | Paid ($49)       | Argos, Talos, Huginn, Muninn            | Enrichment, policy, threat intel, ledger.          |
| **Advanced**   | Enterprise ($99) | Norns, Furies                           | Readiness synthesis, adversarial stress.           |
| **Cockpit**    | Commercial       | Watchtower                              | Visualization, management panel.                   |

---

## Substrate (Open Source)

**Packages:**

- `@tracehound/core` — Deterministic security buffer
- `@tracehound/express` — Express.js adapter
- `@tracehound/fastify` — Fastify adapter
- `@tracehound/cli` — Command-line interface

**Invariants:**

- No hot-path licensing
- No degradation based on payment state
- Fully inspectable source code
- Operates regardless of commercial status

**Includes:**

- Agent.intercept()
- Quarantine buffer
- AuditChain (Merkle)
- RateLimiter
- HoundPool (process isolation)
- Evidence Factory
- Fail-Safe

---

## Satellites ($49/mo per package)

**Target:** Teams needing enrichment and operational intelligence.

### @tracehound/argos

Runtime behavioral observation. Detects event loop starvation, anomalies, and burst attacks.

### @tracehound/talos

External policy execution. Connects to external policy engines (OPA, custom) for decision making.

### @tracehound/huginn

Threat intelligence ingestion. Consumes external threat feeds and correlates with local evidence.

### @tracehound/muninn

Historical ledger & aggregation. Time-series analysis and long-term pattern storage.

---

## Advanced ($99/mo per package)

**Target:** Enterprise teams requiring validation and readiness.

### @tracehound/norns

Deterministic readiness synthesis. Pre-deployment security posture validation.

### @tracehound/furies

Adversarial validation & stress harness. Chaos engineering for security infrastructure.

---

## Cockpit (Commercial — TBD)

### @tracehound/watchtower

**What it is:**

- Forensic cockpit
- Operational visualization layer
- Workflow accelerator

**What it is NOT:**

- Does not create evidence
- Does not make security decisions
- Not a security authority

**Value:** Makes humans effective at using Tracehound substrate.

---

## Pricing Philosophy

### Why Flat Pricing

Per-seat and usage-based pricing:

- Creates procurement friction
- Encourages under-deployment
- Penalizes correct security posture

Flat pricing communicates: _This is infrastructure, not SaaS trivia._

### Why No Runtime License Enforcement

We explicitly reject:

- Feature gates inside core security paths
- License checks in hot paths
- Expiration-driven behavior changes

**Payment affects what you can add, not what you can see.**

---

## License Enforcement

### Core Substrate

**No enforcement.** Open source, MIT licensed.

### Paid Satellites

Standard commercial licensing:

- License key via environment variable
- No hot-path validation
- Graceful degradation to substrate-only

---

## Self-Hosted vs Cloud

| Aspect     | Self-Hosted       | Cloud (Future)    |
| ---------- | ----------------- | ----------------- |
| Substrate  | Free (OSS)        | Free (OSS)        |
| Satellites | License cost      | SaaS subscription |
| Data       | Customer premises | Tracehound Cloud  |
| Support    | Community         | Priority SLA      |

---

## Related Documents

- [tracehound_open_core_product_licensing_rationale.md](./tracehound_open_core_product_licensing_rationale.md) — Strategic rationale
- [GETTING-STARTED.md](./GETTING-STARTED.md) — Quick start guide
