# Tracehound Roadmap v2

> **Updated:** 2026-02-14
> **Scope:** Deterministic runtime security buffer & forensic substrate
> **Model:** Open-Core (Substrate: OSS, Satellites: Commercial)
> **Stack Synergy:** Cluster.127 (Nabu, Mindfry, Atrion, TIR.js)

---

## Strategic Additions (From Market Analysis)

| Initiative               | Description                                                          | Target Phase |
| ------------------------ | -------------------------------------------------------------------- | ------------ |
| **@tracehound/heimdall** | Supply chain security: CI/CD monitoring, package scanning, reporting | Phase 5.5    |
| **AI Detection Engine**  | Threat detection model via Cluster.127 stack                         | Phase 7+     |
| **Multi-Runtime Ports**  | Rust, Python, Go adaptation                                          | Phase 8+     |
| **Influencer Strategy**  | White-hat hacker spokesperson                                        | GTM Phase 1  |
| **Partnership Track**    | Datadog, Cloudflare API-first SLA                                    | Phase 7+     |

---

## Current Status: v1.1.0 Stable ✅

---

## ✅ Completed Phases (v0.1.0 → v1.0.0)

<details>
<summary>Click to expand completed phases</summary>

- v0.1.0: Foundation (Types, Secure ID, Signatures)
- v0.2.0: Evidence & Quarantine
- v0.3.0: Core Logic (Agent, Rate Limiter)
- v0.4.0: Observability (HoundPool, Watcher)
- v0.5.0: Process Isolation
- v0.6.0: Production Ready (P0)
- v0.7.0: Cold Storage (P0 Complete)
- v0.8.0: Adapters (Express, Fastify)
- v1.0.0: CLI, TUI Dashboard, Documentation

</details>

---

## Phase 4 — Production Hardening (v1.1.0)

**Status:** Complete ✅

| Component                           | Status  |
| ----------------------------------- | ------- |
| System Scheduler                    | ✅ Done |
| Security State Refactor             | ✅ Done |
| External Notification API           | ✅ Done |
| Evidence Lifecycle Policy           | ✅ Done |
| Async Codec                         | ✅ Done |
| Cold Storage Adapters (S3, R2, GCS) | ✅ Done |
| K8s Deployment Guide                | ✅ Done |

---

## Phase 4.5 — Package Distribution (v1.1.5)

**Status:** Complete ✅

| Component                     | Priority |
| ----------------------------- | -------- |
| npm @tracehound organization  | P0       |
| Private Registry (Verdaccio)  | P0       |
| Access Token System           | P0       |
| Distribution Webhook          | P1       |
| Update Entitlement (12-month) | P1       |

---

## Phase 5 — Forensics & Compliance (v1.2.0)

**ETA:** 4 weeks after v1.1.0

| Component                                           | Priority |
| --------------------------------------------------- | -------- |
| Incident Verification Record                        | P0       |
| Deterministic Snapshot Export                       | P0       |
| GDPR Erasure API                                    | P0       |
| Evidence Cost Accounting                            | P1       |
| Compliance Framework Mapping (SOC2, HIPAA, PCI-DSS) | P1       |

---

## Phase 5.5 — Heimdall: Supply Chain Security (v1.3.0) 🆕

> **New Product:** `@tracehound/heimdall`
> **Tier:** Role-Based ($49/mo)

| Component              | Description                                  | Priority |
| ---------------------- | -------------------------------------------- | -------- |
| CI/CD Integration      | GitHub Actions, GitLab CI pipeline hooks     | P0       |
| Local Package Scanner  | npm/yarn/pnpm audit on steroids              | P0       |
| Daily Source Monitor   | CVE feeds, npm advisories, custom sources    | P1       |
| Report Generator       | PDF/JSON compliance-ready reports            | P1       |
| Quarantine Integration | Flag suspicious deps → Tracehound quarantine | P2       |

**Rationale:** Supply chain attacks = 55%+ of Node.js security incidents by 2026

---

## Phase 6 — Satellite Products (Parallel)

### Argos — Runtime Behavioral Observer

**Tier:** Role-Based ($49/mo)
**Status:** RFC-0002 approved

| Component                  | Priority |
| -------------------------- | -------- |
| Worker Thread Observer     | P0       |
| Adaptive Sampling          | P0       |
| Ring Buffer                | P0       |
| Behavioral Signal Protocol | P1       |

### Talos — Policy Execution

**Tier:** Role-Based ($49/mo)
**Status:** Placeholder

### Huginn — Threat Intelligence

**Tier:** Role-Based ($49/mo)
**Status:** Placeholder

### Muninn — History Ledger

**Tier:** Role-Based ($49/mo)
**Status:** Placeholder

---

## Phase 6.5 — Control-Based Products

### Norns — Readiness Synthesis

**Tier:** Control-Based ($99/mo)
**Status:** Placeholder

### Furies — Adversarial Stress Testing

**Tier:** Control-Based ($99/mo)
**Status:** Placeholder

---

## Phase 7 — Enterprise & Partnerships (v2.0.0)

**Goal:** Multi-instance, partnerships, AI detection

### Core Components

| Component                                 | Priority |
| ----------------------------------------- | -------- |
| Multi-Instance Coordination (Redis)       | P0       |
| SIEM Exporters (Splunk, Elastic, Datadog) | P0       |
| Instance Telemetry                        | P0       |
| Compliance Reports (SOC2/HIPAA/ISO)       | P1       |

### Partnership Track 🆕

| Partner Target | Integration Type                             |
| -------------- | -------------------------------------------- |
| Cloudflare     | WAF → Tracehound bridge, marketplace listing |
| Datadog        | SIEM exporter, security integration          |
| Vercel         | Edge deployment, marketplace                 |

### AI Detection Engine 🆕

| Component           | Description                          |
| ------------------- | ------------------------------------ |
| Nabu Integration    | Cognitive threat pattern recognition |
| Mindfry Backend     | Threat pattern storage & query       |
| Atrion Resilience   | Detection pipeline protection        |
| TIR.js Coordination | Temporal threat correlation          |

**Goal:** Train proprietary threat detection model using Cluster.127 stack

---

## Phase 8 — Multi-Runtime Expansion (v2.1.0) 🆕

| Runtime | Language   | Priority               |
| ------- | ---------- | ---------------------- |
| Node.js | TypeScript | ✅ Done                |
| Deno    | TypeScript | P1 (ecosystem overlap) |
| Bun     | TypeScript | P1 (ecosystem overlap) |
| Native  | Rust       | P2 (core port)         |
| Python  | Python     | P3                     |
| Go      | Go         | P3                     |

**Rationale:** Deno/Bun share Node.js ecosystem = easy adaptation, TAM expansion

---

## Phase 9 — Watchtower (v2.2.0)

> **Tier:** $299/mo
> **Classification:** Dashboard + Control Plane

| Component           | Description                         |
| ------------------- | ----------------------------------- |
| Unified Dashboard   | Multi-instance threat visualization |
| Control Plane       | Cross-instance policy management    |
| Team Management     | RBAC, audit logs                    |
| Alert Configuration | Webhooks, PagerDuty, Slack          |
| Billing Integration | Stripe, enterprise invoicing        |

---

## GTM Phases (Marketing Integration)

### Phase G1: Developer Adoption (Q1-Q2 2026)

- [ ] Open source launch (npm, GitHub)
- [ ] Dev.to / HackerNews presence
- [ ] "What Happens After WAF?" blog series
- [ ] White-hat hacker spokesperson deal

### Phase G2: Startup Sales (Q3-Q4 2026)

- [ ] Product Hunt launch
- [ ] Y Combinator company outreach
- [ ] First 10 paying customers
- [ ] 1 case study published

### Phase G3: Enterprise & Partners (2027+)

- [ ] SOC2 Type 1 certification
- [ ] Cloudflare/Vercel partnership
- [ ] Enterprise tier ($999+/mo)
- [ ] Channel partnerships

---

## Pricing Tiers (Finalized)

| Tier              | Price        | Classification            |
| ----------------- | ------------ | ------------------------- |
| **Substrate**     | FREE         | Open source core          |
| **Horizon**       | $9 perpetual | Filter (deterrent)        |
| **Role-Based**    | $49/mo       | Task-specific satellites  |
| **Control-Based** | $99/mo       | Runtime manipulation      |
| **Watchtower**    | $299/mo      | Dashboard + Control Plane |

---

## Out of Scope (Locked)

- Inline payload inspection
- Rule engines or detection logic
- ML-based classification (internal only)
- WAF / RASP replacement

---

## Principles (Locked)

- Decision-free
- Detection is external (or our AI layer)
- Payloads never exposed
- Forensics > visualization

---

**Next Review:** 2026-03-01
