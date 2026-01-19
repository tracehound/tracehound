# Tracehound Roadmap

> **Scope:** Deterministic runtime security buffer & forensic substrate
> **Core Invariants:** Decision-free, payload-less, GC-independent
> **Model:** Open-Core (Substrate: OSS, Satellites: Commercial)

---

## Current Status: v1.0.0 Stable

---

## ✅ Completed Phases

### v0.1.0 - Foundation

- [x] Core Types (Scent, Threat, EvidenceHandle)
- [x] Secure ID (UUIDv7)
- [x] Signature generation/validation
- [x] Deterministic JSON serialization

### v0.2.0 - Evidence & Quarantine

- [x] Evidence class with ownership semantics
- [x] Quarantine buffer with priority eviction
- [x] Audit Chain (Merkle-chain)

### v0.3.0 - Core Logic

- [x] Agent (intercept → InterceptResult)
- [x] Rate Limiter (token bucket, source blocking)
- [x] Evidence Factory

### v0.4.0 - Observability & Resilience

- [x] Hound Pool (isolated processing)
- [x] Tick Scheduler (jittered)
- [x] Watcher (pull-based observability)
- [x] Binary Codec (gzip)

### v0.5.0 - Hound Process Isolation

- [x] Child process-based isolation
- [x] Binary IPC protocol
- [x] Process Adapter pattern
- [x] PoolExhaustedAction

### v0.6.0 - Production Ready (P0)

- [x] Binary Codec Integrity (SHA-256)
- [x] Runtime Flags (--frozen-intrinsics)
- [x] Scenarios directory structure

### v0.7.0 - P0 Complete

- [x] Cold Storage Adapter (`IColdStorageAdapter`)
- [x] Trust Boundary Runtime
- [x] Rename hound-worker → hound-process

### v0.8.0 - P1 Complete

- [x] Express Adapter (`@tracehound/express`)
- [x] Fastify Adapter (`@tracehound/fastify`)
- [x] API Documentation
- [x] Granular Error Codes (35+ factories)
- [x] Purge + Replace API
- [x] Lane Queue
- [x] Fail-Safe Panic
- [x] Scenario Tests

### v1.0.0 - Stable Release

- [x] CLI Interface (`@tracehound/cli`)
- [x] TUI Dashboard (Pure ANSI)
- [x] Comprehensive Documentation
- [x] Private Release (Enterprise/Premium)

---

## Phase 4 — Production Hardening (v1.1.0)

> [!IMPORTANT] > **Scope Clarification:** This phase targets single-instance production readiness.
> Multi-instance coordination (Redis) is Phase 7 scope for enterprise scale-out.

**Goal:** Bullet-proof single instance with external observability
**Timeline:** 4–6 weeks after v1.0.0

### Core Components

| Component                 | Description                                     | Priority |
| ------------------------- | ----------------------------------------------- | -------- |
| System Scheduler          | JitteredTickScheduler implementation ✅         | Done     |
| Security State Refactor   | Unified state substrate ✅                      | Done     |
| External Notification API | Universal event emission ✅                     | Done     |
| Evidence Lifecycle Policy | Declarative retention / eviction policies ✅    | Done     |
| Async Codec               | `@tracehound/codec-async` - Cold-path streaming | P1       |
| Cold Storage Adapters     | `@tracehound/cold-s3`, `cold-r2`, `cold-gcs`    | P1       |

### Critic Feedback Items

| Component                 | Description                                       | Priority |
| ------------------------- | ------------------------------------------------- | -------- |
| IPC Stress Test Suite     | stdio vs alternatives benchmark + resilience test | Done ✅  |
| Fail-Open Behavior Doc    | Explicit panic → pass-through spec                | Done ✅  |
| Performance SLA Document  | p50, p99, p99.9 latency guarantees                | Done ✅  |
| Local State Semantics Doc | "Each instance owns its state" explicit warning   | Done ✅  |
| Cold Storage Security     | mTLS spec, encryption requirements                | Done ✅  |
| K8s Deployment Guide      | cgroups-aware pool, OOMKiller prevention          | P1       |

### Async Codec Note

> [!NOTE]
> Async Codec is for **cold-path only** (evacuation, cold storage writes).
> Hot-path (`intercept()`) remains **synchronous**.
> Eviction under pressure uses "Drop on Full" or "Background Flush" — never sync cold write.

### Success Criteria

- [x] IPC handles 100k req/s without blocking
- [x] Fail-open behavior explicitly documented
- [x] **Local State Semantics** documented (no global blocklists)
- [x] Notification API introduces zero backpressure
- [x] Policies remain deploy-time, not runtime-interactive

---

## Phase 4.5 — Package Distribution Infrastructure (v1.1.5)

> **Classification:** Internal infrastructure (not customer-facing)
> **Access:** Tracehound team only

**Goal:** Commercial satellite package distribution and access management
**Timeline:** Parallel with Phase 4

### Core Components

| Component            | Description                                    | Priority |
| -------------------- | ---------------------------------------------- | -------- |
| npm Organization     | @tracehound scoped packages on npm             | P0       |
| Private Registry     | Satellite packages via private npm (Verdaccio) | P0       |
| Access Token System  | Per-customer npm auth tokens (time-bounded)    | P0       |
| Distribution Webhook | Payment → token generation automation          | P1       |
| Update Entitlement   | 12-month update window tracking                | P1       |

### Technical Notes

- Satellites distributed via private npm, NOT runtime-locked
- Access token grants package download, NOT runtime enforcement
- Perpetual use of downloaded version (per OPEN_CORE_STRATEGY)
- No kill-switches, no runtime license checks

---

## Phase 5 — Forensics & Compliance (v1.2.0)

**Goal:** Forensic substrate and compliance enabler
**Timeline:** 4 weeks after v1.1.0

### Core Components

| Component                     | Description                                    | Priority |
| ----------------------------- | ---------------------------------------------- | -------- |
| Incident Verification Record  | Immutable, payload-less descriptor             | P0       |
| Deterministic Snapshot Export | Read-only system state for offline analysis    | P0       |
| Evidence Cost Accounting      | Memory + cold storage cost visibility          | P1       |
| Threat Coalescing             | Time-window aggregation for repetitive threats | P1       |
| DPS (Payload Summary)         | Deterministic summary for explainability       | P2       |

### Critic Feedback Items (NEW)

| Component                    | Description                               | Priority |
| ---------------------------- | ----------------------------------------- | -------- |
| GDPR Erasure API             | Evidence/quarantine delete capability     | P0       |
| Retention Policy Config      | Explicit TTL + policy documentation       | P1       |
| Compliance Framework Mapping | PCI-DSS, SOC2, HIPAA control mapping docs | P1       |
| Audit Log Encryption         | At-rest encryption for audit chain        | P2       |

### Explicit Non-Goals

- Payload replay or re-execution
- Interactive dashboards
- Content inspection or mutation
- ML-based scoring

---

## Phase 5.5 — Cloud Dashboard (v1.3.0)

> **Classification:** Customer-facing SaaS
> **Access:** Paying customers (self-service)

**Goal:** Threat visualization and cold storage access for customers
**Timeline:** Post Phase 5

### Core Components

| Component           | Description                      | Priority |
| ------------------- | -------------------------------- | -------- |
| Threat Dashboard    | Real-time threat visualization   | P0       |
| Evidence Browser    | Cold storage evidence access     | P0       |
| Team Management     | Per-tenant user/role management  | P0       |
| Alert Configuration | Webhook/email notification setup | P1       |
| Billing Integration | Stripe subscription management   | P1       |

### Architecture Notes

- Each tenant has own root admin
- Consumes data from @tracehound/core Notification API
- Separate from Internal Admin Panel
- Public cloud deployment (Vercel/AWS)

---

## Phase 6 — Argos (Separate Product Track)

> **Product Classification:** Standalone offering with independent sales cycle
> **Specification:** RFC-0002 (v2: Production Architecture)
> **Relationship:** Optional integration via `@argos/tracehound-bridge`

**Goal:** Production-grade runtime behavioral observer
**Timeline:** Parallel development track

| Component                  | Description                                      | Priority |
| -------------------------- | ------------------------------------------------ | -------- |
| Worker Thread Observer     | Starvation-immune observation layer              | P0       |
| Adaptive Sampling          | Dynamic frequency based on anomaly detection     | P0       |
| Ring Buffer                | Retroactive analysis capability                  | P0       |
| Behavioral Signal Protocol | Confidence-tagged signals for external detectors | P1       |
| Native Watchdog            | Optional libuv-based failsafe                    | P2       |

### Architectural Invariants

- Argos signals NEVER enter Tracehound directly (bridge is optional)
- Worker Thread provides independent event loop
- Sampling adapts automatically (baseline → burst → cooldown)
- No kernel, syscall, or memory dump access
- **Standalone product** — no Tracehound dependency

### Success Criteria

- [ ] Event loop starvation detection within 3 seconds
- [ ] Burst attack detection (>100ms duration)
- [ ] <1% CPU overhead (baseline mode)
- [ ] ~85% threat coverage (vs ~30% RFC-0002)

### Known Limitations (Documented)

- Cannot detect issues preventing all JS execution
- Ultra-short attacks (<100ms) partially covered
- Requires Node.js 12+ for Worker Threads

---

## Phase 7 — Cluster & Enterprise Scale (v2.0.0)

**Goal:** Kubernetes, autoscaling, and regulatory compliance
**Timeline:** Post Argos stabilization

### Core Components

| Component              | Description                                     | Priority |
| ---------------------- | ----------------------------------------------- | -------- |
| Multi-Instance Coord   | Redis-backed, non-authoritative state           | P0       |
| SIEM Exporters         | Splunk HEC, Elastic, Datadog                    | P0       |
| **Instance Telemetry** | **Enterprise heartbeat tracking + enforcement** | **P0**   |
| Compliance Reports     | SOC2 / HIPAA / ISO evidence export              | P1       |

### Infrastructure as Code

| Component        | Description                           | Priority |
| ---------------- | ------------------------------------- | -------- |
| Helm Chart       | Official K8s deployment chart         | P0       |
| Terraform Module | AWS/GCP/Azure reference modules       | P1       |
| Argos Bridge     | `@argos/tracehound-bridge` production | P1       |

### Critic Feedback Items

| Component            | Description                              | Priority |
| -------------------- | ---------------------------------------- | -------- |
| Scent.identity       | Auth/session context in Scent (RFC-0000) | P0       |
| RFC-0004 ResponseEng | Optional external policy-driven response | P1       |
| RFC-0005 ThreatIntel | External threat feed integration API     | P2       |
| Incident Response    | Ticket creation, runbook automation      | P2       |

> [!NOTE] > **RFC-0004 (ResponseEngine)** and **RFC-0005 (ThreatIntel)** are optional addons.
> They do NOT violate "decision-free" principle — external policy engines drive decisions.

### Upsell Path

```
Phase 4 Customer: "Tek instance'da çalışıyorum, logları SIEM'e atıyorum"
         │
         ▼ Growth → Scale-out needed
Phase 7 Customer: "Global ban istiyorum, Redis ile koordinasyon lazım"
         │
         ▼ Upgrade to Enterprise tier
```

---

## Phase 8 — Edge Runtime (v2.1.0)

| Component          | Description          |
| ------------------ | -------------------- |
| Cloudflare Workers | Edge-compatible core |
| Vercel Edge        | Edge-compatible core |
| Lambda@Edge        | AWS Edge integration |

---

## ThreatLedger — Separate Product (Post v2.2.0)

> **Product Classification:** Standalone offering with independent sales cycle
> **Specification:** RFC-0003
> **Prerequisite:** Tracehound Core v1.1.0+ (Security State Substrate)

ThreatLedger is a **threat metadata substrate** designed for:

- Research & cure development
- External analytics / ML training
- Pattern correlation & temporal analysis

| Component     | Description                              |
| ------------- | ---------------------------------------- |
| Hot Layer     | In-memory O(1) query, 10k records        |
| Cold Layer    | NDJSON operational logs, external tools  |
| Archive Layer | Compressed binary, research data         |
| Query API     | Signature, category, severity, timerange |

**Architectural Invariants:**

- Decision-free (observation-only)
- No evidence storage (metadata only)
- Separate namespace from Quarantine

---

## Explicitly Out of Scope (Locked)

These are **permanently excluded** to preserve product identity:

- Inline payload inspection (content-aware)
- Full observability dashboards
- Rule engines or detection logic
- ML-based classification
- WAF / RASP replacement features

---

## Roadmap Principles (Locked)

- Tracehound remains **decision-free**
- Detection is always **external**
- Payloads are **never exposed**
- Explainability > interactivity
- Forensics > visualization

---

**Last Updated:** 2026-01-19
