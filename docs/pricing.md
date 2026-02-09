# Tracehound Pricing Model

> **Updated:** 2026-02-10
> **Model:** Open-Core (Substrate: OSS, Satellites: Commercial)
> **Philosophy:** Tiered value, not request counting

---

## Pricing Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   WATCHTOWER — $299/mo                          │
│                   Dashboard + Control Plane                     │
├─────────────────────────────────────────────────────────────────┤
│  CONTROL-BASED — $99/mo          │  ROLE-BASED — $49/mo         │
│  Runtime + Process Control       │  Task-Specific Symbiosis     │
│  ┌─────────┐  ┌─────────┐        │  ┌─────────┐  ┌─────────┐    │
│  │  Norns  │  │ Furies  │        │  │  Argos  │  │  Talos  │    │
│  │Readiness│  │ Stress  │        │  │ Observe │  │ Policy  │    │
│  └─────────┘  └─────────┘        │  ├─────────┤  ├─────────┤    │
│                                  │  │ Huginn  │  │ Muninn  │    │
│                                  │  │  Intel  │  │ History │    │
│                                  │  ├─────────┤  └─────────┘    │
│                                  │  │Heimdall │                 │
│                                  │  │Supply Ch│                 │
│                                  │  └─────────┘                 │
├─────────────────────────────────────────────────────────────────┤
│    SUBSTRATE — FREE (OSS) + HORIZON — $9 perpetual (Filter)     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tier Overview

| Tier              | Price          | Classification                | Examples                                |
| ----------------- | -------------- | ----------------------------- | --------------------------------------- |
| **Substrate**     | FREE           | Open-source core              | Core, Express adapter, Fastify adapter  |
| **Horizon**       | $9 perpetual   | Scale-out config (filter)     | HoundPool, Extended Quarantine          |
| **Role-Based**    | $49/mo         | Task-specific satellites      | Argos, Talos, Huginn, Muninn, Heimdall  |
| **Control-Based** | $99/mo         | Runtime manipulation          | Norns, Furies                           |
| **Watchtower**    | $299/mo        | Dashboard + Control Plane     | Multi-instance monitoring & control     |

---

## Tier Details

### 1. Substrate (Free)

**The Foundation — Open-Source Core**

| Aspect         | Value                                       |
| -------------- | ------------------------------------------- |
| **Price**      | $0                                          |
| **Target**     | All developers                              |
| **What**       | Core security buffer, framework adapters    |

**Includes:**

- Agent, Quarantine, AuditChain, RateLimiter
- Express and Fastify adapters
- CLI and TUI dashboard
- Community support (GitHub Issues)

**Strategy:** `npm install @tracehound/core` — zero-friction adoption. Build the community, earn trust, create the funnel.

---

### 2. Horizon ($9 Perpetual)

**The Filter — Serious Users Only**

| Aspect         | Value                                            |
| -------------- | ------------------------------------------------ |
| **Price**      | $9 one-time (perpetual license)                  |
| **Target**     | Teams needing scale-out configuration            |
| **What**       | Extended features for production workloads        |

**Includes:**

- Extended HoundPool configuration
- Extended Quarantine capacity
- 12-month update entitlement

**Strategy:** The $9 price point is a filter, not a revenue driver. It separates serious users from casual tire-kickers and establishes a payment relationship for future upsells.

---

### 3. Role-Based ($49/mo per package)

**The Expansion — Task-Specific Satellites**

| Aspect         | Value                                          |
| -------------- | ---------------------------------------------- |
| **Price**      | $49/month per satellite package                |
| **Target**     | Teams needing specialized security capabilities|
| **What**       | Symbiotic extensions to the Tracehound core    |

**Available Satellites:**

| Satellite      | Role                              | Status       |
| -------------- | --------------------------------- | ------------ |
| **Argos**      | Runtime behavioral observer       | RFC-0002     |
| **Talos**      | Policy-driven response execution  | RFC-0003     |
| **Huginn**     | External threat feed integration  | RFC-0005     |
| **Muninn**     | Threat metadata substrate/archive | RFC-0004     |
| **Heimdall**   | Supply chain security             | RFC-0006     |
| **Loki**       | Passive Deception & Tarpit Layer  | RFC-0007     |

**Strategy:** Each satellite addresses a specific security role. Teams adopt what they need — no bloated bundles. The satellite model creates natural expansion revenue as teams mature their security posture.

---

### 4. Control-Based ($99/mo per package)

**The Power Tier — Runtime Manipulation**

| Aspect         | Value                                        |
| -------------- | -------------------------------------------- |
| **Price**      | $99/month per package                        |
| **Target**     | Security-mature teams, SRE, DevSecOps        |
| **What**       | Runtime-level control and process manipulation|

**Available Packages:**

| Package        | Role                          | Status       |
| -------------- | ----------------------------- | ------------ |
| **Norns**      | Readiness synthesis           | Planned      |
| **Furies**     | Adversarial stress testing    | Planned      |

**Strategy:** Higher price reflects higher value — these packages actively manipulate runtime behavior rather than passively observing or recording.

---

### 5. Watchtower ($299/mo)

**The Command Center — Dashboard + Control Plane**

| Aspect         | Value                                           |
| -------------- | ----------------------------------------------- |
| **Price**      | $299/month                                      |
| **Target**     | Enterprises, multi-instance deployments         |
| **What**       | Unified visualization and cross-instance control|

**Includes:**

- Multi-instance threat visualization dashboard
- Cross-instance policy management
- Team management (RBAC, audit logs)
- Alert configuration (Webhooks, PagerDuty, Slack)
- Billing integration (Stripe, enterprise invoicing)

---

## Comparison Matrix

| Feature                | Substrate | Horizon | Role-Based | Control-Based | Watchtower |
| ---------------------- | --------- | ------- | ---------- | ------------- | ---------- |
| **Price**              | Free      | $9      | $49/mo     | $99/mo        | $299/mo    |
| **Core Engine**        | Yes       | Yes     | Yes        | Yes           | Yes        |
| **Framework Adapters** | Yes       | Yes     | Yes        | Yes           | Yes        |
| **Extended Config**    | --        | Yes     | Yes        | Yes           | Yes        |
| **Satellite Packages** | --        | --      | Yes        | Yes           | Yes        |
| **Runtime Control**    | --        | --      | --         | Yes           | Yes        |
| **Dashboard**          | --        | --      | --         | --            | Yes        |
| **Support**            | Community | Email   | Email      | Priority      | Dedicated  |

---

## Pricing Philosophy

### 1. Horizon = Filter, Not Revenue

The $9 perpetual license separates serious users from casual downloads. It establishes a payment relationship without creating adoption friction.

### 2. Role-Based = Expand

Each satellite package addresses a distinct security need. Teams start with one and expand as their security posture matures. $49/mo per package keeps the price approval-free for most engineering leads.

### 3. Control-Based = Manage

Runtime manipulation commands a higher price. These packages provide active control, not passive observation.

### 4. Watchtower = Command

Enterprise-grade visualization and multi-instance control. The $299/mo price point targets engineering managers and VPs with existing security budgets.

### 5. No Surprise Bills

Flat per-package pricing. No per-request quotas, no per-seat scaling, no usage metering. Predictable costs for CFOs.

---

## Related Documents

- [STRATEGY.md](./STRATEGY.md) — Go-to-market strategy and market analysis
- [ROADMAP.md](./ROADMAP.md) — Development phases and timeline
- [RFC-0008: Rust Core Pivot](./rfc/0008-RustCorePivot.md) — Technical architecture
