# Tracehound Roadmap [LOCKED]

> **Scope:** Deterministic runtime security buffer & forensic substrate
> **Core Invariants:** Decision-free, payload-less, GC-independent
> **License:** Commercial (Enterprise / Premium)

---

## Current Status: v0.8.0 → v1.0.0 Stable

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

---

## 🔲 v1.0.0 Stable (In Progress)

### Remaining Items

| Item               | Package           | Priority | Status |
| ------------------ | ----------------- | -------- | ------ |
| CLI Interface      | `@tracehound/cli` | HIGH     | 🔲     |
| TUI Dashboard      | `@tracehound/cli` | MEDIUM   | 🔲     |
| Comprehensive Docs | `docs/`           | HIGH     | 🔲     |

### Success Criteria

| Criterion           | Target              | Status |
| ------------------- | ------------------- | ------ |
| intercept() latency | < 1ms p99           | ✅     |
| Memory stability    | 100k threats        | ✅     |
| Error codes         | Granular            | ✅     |
| Scenario tests      | Full lifecycle      | ✅     |
| CLI basic           | `tracehound status` | 🔲     |
| Documentation       | Getting started     | 🔲     |

---

## Phase 4 — Enterprise Hardening (v1.1.0)

**Goal:** Enterprise integration ready security component
**Timeline:** 4–6 weeks after v1.0.0

| Component                  | Description                                          | Priority |
| -------------------------- | ---------------------------------------------------- | -------- |
| External Notification API  | Read-only event emission (SIEM, SOC, pipelines)      | P0       |
| Event Taxonomy & Contracts | Frozen event set (at-most-once, unordered, no retry) | P0       |
| Evidence Lifecycle Policy  | Declarative retention / eviction policies            | P1       |
| Async Codec                | `@tracehound/codec-async` - Streaming gzip           | P1       |
| Cold Storage Adapters      | `@tracehound/cold-s3`, `cold-r2`, `cold-gcs`         | P1       |

### Success Criteria

- [ ] Notification API introduces zero backpressure
- [ ] Policies remain deploy-time, not runtime-interactive

---

## Phase 5 — Forensics & Compliance (v1.2.0)

**Goal:** Forensic substrate and compliance enabler
**Timeline:** 4 weeks after v1.1.0

| Component                     | Description                                    | Priority |
| ----------------------------- | ---------------------------------------------- | -------- |
| Incident Verification Record  | Immutable, payload-less descriptor             | P0       |
| Deterministic Snapshot Export | Read-only system state for offline analysis    | P0       |
| Evidence Cost Accounting      | Memory + cold storage cost visibility          | P1       |
| Threat Coalescing             | Time-window aggregation for repetitive threats | P1       |
| DPS (Payload Summary)         | Deterministic summary for explainability       | P2       |

### Explicit Non-Goals

- Payload replay or re-execution
- Interactive dashboards
- Content inspection or mutation
- ML-based scoring

---

## Phase 6 — Argos & Behavioral Signals (v1.3.0)

**Goal:** Visibility beyond request lifecycle
**Timeline:** 6–8 weeks after v1.2.0

| Component                  | Description                                      | Priority |
| -------------------------- | ------------------------------------------------ | -------- |
| tracehound-argos           | Runtime behavioral observer (sampling-based)     | P0       |
| Behavioral Signal Protocol | Confidence-tagged signals for external detectors | P0       |
| Argos WorkingMemory        | Ephemeral aggregation substrate                  | P1       |
| Signal Rate Limiting       | Protection against signal flood                  | P1       |

### Architectural Invariants

- Argos signals NEVER enter Tracehound core
- Argos WorkingMemory is physically separate from Quarantine
- Sampling-only, no continuous observation
- No kernel, syscall, or memory dump access

### Success Criteria

- [ ] <1% CPU overhead under load
- [ ] Zero coupling with request lifecycle
- [ ] Core determinism guarantees preserved

---

## Phase 7 — Enterprise Integrations (v2.0.0)

**Goal:** Operationalize inside enterprise security stacks
**Timeline:** Post Argos stabilization

| Component            | Description                     | Priority |
| -------------------- | ------------------------------- | -------- |
| SIEM Exporters       | Splunk HEC, Elastic, Datadog    | P0       |
| Multi-Instance Coord | Redis-backed, non-authoritative | P1       |
| Compliance Reports   | SOC2 / HIPAA evidence export    | P1       |

---

## Phase 8 — Edge Runtime (v2.1.0)

| Component          | Description          |
| ------------------ | -------------------- |
| Cloudflare Workers | Edge-compatible core |
| Vercel Edge        | Edge-compatible core |
| Lambda@Edge        | AWS Edge integration |

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
