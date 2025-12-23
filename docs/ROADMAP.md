# Tracehound Roadmap

## Current Status: v0.6.0

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

---

## 🔲 Remaining for v1.0.0

### P0 - Required

| Component             | Status | Notes                           |
| --------------------- | ------ | ------------------------------- |
| Trust Boundary Config | 🔲     | RFC-defined, needs runtime impl |
| Cold Storage Adapter  | 🔲     | Interface only, no impl         |

### P1 - Important

| Component         | Status | Notes                 |
| ----------------- | ------ | --------------------- |
| Express Adapter   | 🔲     | `@tracehound/express` |
| Fastify Adapter   | 🔲     | `@tracehound/fastify` |
| API Documentation | 🔲     | TSDoc → site          |

### P2 - Nice to Have

| Component           | Status | Notes                |
| ------------------- | ------ | -------------------- |
| Purge + Replace API | 🔲     | Explicit purge flow  |
| Lane Queue          | 🔲     | Priority alert queue |
| Fail-Safe Panic     | 🔲     | Threshold callbacks  |

---

## Future Phases

### v1.1.0 - Enterprise (Commercial)

- Cold Storage: S3, R2, GCS adapters
- Redis Cluster coordination
- Dashboard API

### v2.0.0 - Edge (Commercial)

- Cloudflare Workers
- Vercel Edge
- Lambda@Edge

### v2.1.0 - SIEM (Commercial)

- Splunk, Elastic, Datadog
- SOC2/HIPAA compliance

---

## Success Criteria for v1.0.0

- [ ] intercept() < 1ms (p99)
- [ ] Memory stable under 100k threats
- [ ] Production deployment guide
- [ ] npm publish ready

---

**Last Updated:** 2024-12-23
