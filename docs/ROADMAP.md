# Tracehound Roadmap

> **Scope:** Deterministic runtime security buffer & forensic substrate
> **Core Invariants:** Decision-free, payload-less, GC-independent
> **License:** Commercial (Enterprise / Premium)

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

## Phase 4 — Enterprise Hardening (v1.1.0)

**Goal:** Production-validated, enterprise integration ready security component
**Timeline:** 4–6 weeks after v1.0.0

### Core Components

| Component                 | Description                                        | Priority |
| ------------------------- | -------------------------------------------------- | -------- |
| System Scheduler          | JitteredTickScheduler implementation (clean slate) | P0       |
| Security State Refactor   | Unified state substrate (Thread Ledger prereq)     | P0       |
| External Notification API | Read-only event emission (SIEM, SOC, pipelines)    | P0       |
| Evidence Lifecycle Policy | Declarative retention / eviction policies          | P1       |
| Async Codec               | `@tracehound/codec-async` - Streaming gzip         | P1       |
| Cold Storage Adapters     | `@tracehound/cold-s3`, `cold-r2`, `cold-gcs`       | P1       |

### Critic Feedback Items (NEW)

| Component                | Description                                       | Priority |
| ------------------------ | ------------------------------------------------- | -------- |
| IPC Stress Test Suite    | stdio vs alternatives benchmark, production proof | P0       |
| Fail-Open Behavior Doc   | Explicit panic → pass-through spec                | P0       |
| Performance SLA Document | p50, p99, p99.9 latency guarantees                | P0       |
| Cold Storage Security    | mTLS spec, encryption requirements                | P1       |
| K8s Deployment Guide     | cgroups-aware pool, OOMKiller prevention          | P1       |

### Success Criteria

- [ ] IPC handles 100k req/s without blocking
- [ ] Fail-open behavior explicitly documented
- [ ] Notification API introduces zero backpressure
- [ ] Policies remain deploy-time, not runtime-interactive

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

## Phase 7 — Enterprise Integrations (v2.0.0)

**Goal:** Operationalize inside enterprise security stacks
**Timeline:** Post Argos stabilization

### Core Components

| Component            | Description                     | Priority |
| -------------------- | ------------------------------- | -------- |
| SIEM Exporters       | Splunk HEC, Elastic, Datadog    | P0       |
| Multi-Instance Coord | Redis-backed, non-authoritative | P1       |
| Compliance Reports   | SOC2 / HIPAA evidence export    | P1       |

### Critic Feedback Items (NEW)

| Component            | Description                              | Priority |
| -------------------- | ---------------------------------------- | -------- |
| Scent.identity       | Auth/session context in Scent (RFC-0000) | P0       |
| RFC-0004 ResponseEng | Optional external policy-driven response | P1       |
| RFC-0005 ThreatIntel | External threat feed integration API     | P2       |
| Incident Response    | Ticket creation, runbook automation      | P2       |

> [!NOTE] > **RFC-0004 (ResponseEngine)** and **RFC-0005 (ThreatIntel)** are optional addons.
> They do NOT violate "decision-free" principle — external policy engines drive decisions.

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

**Last Updated:** 2024-12-27
