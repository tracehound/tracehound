# Tracehound Roadmap

## Current Status: v0.8.0 → v1.0.0 Stable

---

## ✅ Completed

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

### v0.7.0 - v1.0.0 P0 Complete

- [x] Cold Storage Adapter (`IColdStorageAdapter`)
- [x] Trust Boundary Runtime
- [x] Rename hound-worker → hound-process

### v0.8.0 - v1.0.0 P1 Complete

- [x] Express Adapter (`@tracehound/express`)
- [x] Fastify Adapter (`@tracehound/fastify`)
- [x] API Documentation

---

## 🔲 v1.0.0 Stable Requirements

### Tech Debt (Must Fix)

| Item                 | Location             | Priority | Notes                   |
| -------------------- | -------------------- | -------- | ----------------------- |
| Granular Error Codes | `errors.ts`          | HIGH     | Categorize by domain    |
| Windows Constraints  | `process-adapter.ts` | MEDIUM   | Enforce or document     |
| Scenario Tests       | `scenarios/`         | HIGH     | Full lifecycle coverage |

### New Features (Must Have)

| Item               | Package           | Priority | Notes                   |
| ------------------ | ----------------- | -------- | ----------------------- |
| CLI Interface      | `@tracehound/cli` | HIGH     | Status, stats, inspect  |
| TUI Dashboard      | `@tracehound/cli` | MEDIUM   | Real-time threat view   |
| Comprehensive Docs | `docs/`           | HIGH     | Getting started, guides |

### P2 Features ✅ DONE

| Item                | Notes                                |
| ------------------- | ------------------------------------ |
| Purge + Replace API | ✅ `quarantine.purge()`, `replace()` |
| Lane Queue          | ✅ Priority-based alerts             |
| Fail-Safe Panic     | ✅ Threshold callbacks               |

---

## Success Criteria for v1.0.0 Stable

| Criterion           | Status | Target                |
| ------------------- | ------ | --------------------- |
| intercept() latency | 🔲     | < 1ms p99             |
| Memory stability    | 🔲     | 100k threats          |
| Error codes         | 🔲     | Granular, documented  |
| Scenario tests      | 🔲     | Full lifecycle        |
| CLI basic           | 🔲     | `tracehound status`   |
| Documentation       | 🔲     | Getting started guide |
| npm publish         | 🔲     | 3 packages ready      |

---

## Post v1.0.0: Sentinel Integration

After v1.0.0 stable, begin `tracehound-sentinel` development:

- RFC-0002 implementation
- Behavioral signal protocol
- Detector integration

---

## Future Phases (Commercial)

### v1.1.0 - Enterprise

- Cold Storage: S3, R2, GCS adapters (`@tracehound/cold-s3`, etc.)
- Async Codec (`@tracehound/codec-async`) - Streaming gzip for large payloads
- Redis Cluster coordination
- Dashboard API

### v2.0.0 - Edge

- Cloudflare Workers
- Vercel Edge
- Lambda@Edge

### v2.1.0 - SIEM

- Splunk, Elastic, Datadog
- SOC2/HIPAA compliance

---

**Last Updated:** 2024-12-27
