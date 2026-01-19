# Tracehound Pricing Model

> **Model:** Open-Core + Paid Satellites
> **Core Principle:** Monetize capability, not safety.
> **Licensing:** Perpetual use with time-bounded update entitlement (12 months)

---

## Architecture Layers

| Layer          | Access             | Packages                                         | Purpose                                            |
| -------------- | ------------------ | ------------------------------------------------ | -------------------------------------------------- |
| **Substrate**  | Free & Open Source | @tracehound/core, express, fastify, cli, horizon | Deterministic evidence, interception, containment. |
| **Satellites** | $49/mo per package | Argos, Talos, Huginn, Muninn                     | Enrichment, policy, threat intel, ledger.          |
| **Advanced**   | $99/mo per package | Norns, Furies                                    | Readiness synthesis, adversarial stress.           |
| **Watchtower** | Subscription       | Watchtower                                       | Visualization, workflow acceleration.              |

> **Note:** Horizon ($9 perpetual) is part of the Substrate layer. It extends core defaults for scale-out scenarios.

---

## Substrate (Free & Open Source)

**Packages:**

- `@tracehound/core` — Deterministic security buffer
- `@tracehound/express` — Express.js adapter
- `@tracehound/fastify` — Fastify adapter
- `@tracehound/cli` — Command-line interface

**Invariants:**

- No runtime licensing
- No degradation based on payment state
- Fully inspectable source code
- Operates regardless of commercial status

**Includes:**

- Agent.intercept()
- Quarantine buffer
- AuditChain (Merkle)
- RateLimiter
- HoundPool (8 processes max by default)
- Evidence Factory
- Fail-Safe

---

## Horizon ($9 perpetual)

**What it is:** Config extender for scale-out scenarios.

`@tracehound/horizon` unlocks:

| Capability                | Core Default | + Horizon |
| ------------------------- | ------------ | --------- |
| HoundPool processes       | 8 max        | Unlimited |
| Multi-instance (Redis)    | ❌           | ✅        |
| mTLS enforcement          | ❌           | ✅        |
| Policy broker integration | ❌           | ✅        |

**Why $9 Perpetual:**

- One-time purchase, use forever
- Low barrier for teams that need to scale
- No monthly commitment for infrastructure extension

**Usage:**

```typescript
import '@tracehound/horizon' // Must be FIRST
import { Agent } from '@tracehound/core'

// Core now operates with extended limits
```

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

**Target:** Teams requiring validation and stress testing.

### @tracehound/norns

Deterministic readiness synthesis. Pre-deployment security posture validation.

### @tracehound/furies

Adversarial validation & stress harness. Chaos engineering for security infrastructure.

---

## Watchtower (Subscription)

### @tracehound/watchtower

**What it is:**

- Forensic cockpit
- Operational visualization layer
- Workflow accelerator

**What it is NOT:**

- Does not create evidence
- Does not make security decisions
- Not a security authority

**Why Subscription?** Watchtower is an operational interface, not a security substrate. Its value derives from continuous evolution, schema alignment, and UX iteration.

---

## Pricing Philosophy

### Flat Per-Package Pricing

Per-seat and usage-based pricing:

- Creates procurement friction
- Encourages under-deployment
- Penalizes correct security posture

Flat pricing communicates: _This is infrastructure, not SaaS trivia._

### Perpetual Use with Time-Bounded Updates

When a satellite package is purchased:

1. Customer receives **perpetual right to use the acquired version**
2. Updates and security fixes provided for **12 months**
3. After 12 months, existing version continues working indefinitely
4. Renewal grants access to new releases

### No Runtime Enforcement

We explicitly reject:

- Feature gates inside core security paths
- Runtime license checks
- Expiration-driven behavior changes
- Kill-switches

**Payment affects what you can download, not what you can run.**

---

## Distribution Model

### Core Substrate

**Public npm.** Open source, MIT licensed.

```bash
npm install @tracehound/core
```

### Paid Satellites

**Private npm registry.** Access via per-customer auth token.

```bash
npm login --registry=https://npm.tracehound.co
npm install @tracehound/argos
```

- Token grants download access for 12 months
- Downloaded packages work forever (perpetual use)
- No runtime phone-home or validation

---

## Related Documents

- [OPEN_CORE_STRATEGY.md](./OPEN_CORE_STRATEGY.md) — Strategic rationale
- [GETTING-STARTED.md](./GETTING-STARTED.md) — Quick start guide
