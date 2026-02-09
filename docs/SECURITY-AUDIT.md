# Security Audit Roadmap

> **Status:** Pre-audit preparation
> **Target:** Q2 2026
> **Applies to:** @tracehound/core v1.x

---

## Executive Summary

Tracehound is a security product that handles threat evidence, cryptographic operations, and process isolation. A formal external security audit is planned before commercial tier launch. This document outlines the audit strategy, scope, and preparation checklist.

---

## Current Security Posture

### Controls in Place

| Control | Implementation | Status |
| ------- | -------------- | ------ |
| Constant-time comparison | `crypto.timingSafeEqual` | Verified |
| SHA-256 hashing | `crypto.createHash('sha256')` | Verified |
| Tamper-evident audit log | Hash-linked AuditChain | Verified |
| Process isolation | Child process sandbox (no eval, no network) | Verified |
| Memory bounds | Quarantine maxCount/maxBytes, HoundPool maxActive | Verified |
| Fail-open semantics | Errors return safe InterceptResult | Verified |
| Rate limiting | Per-source windowed rate limiter | Verified |
| Binary integrity | THCS envelope with SHA-256 verification | Verified |
| Input validation | Payload size limits, boundary checks | Verified |
| Minimal dependencies | 1 runtime dependency (uuid) | Verified |
| Lock file committed | pnpm-lock.yaml in repository | Verified |
| CI security | `--frozen-lockfile`, `pnpm audit` in pipeline | Verified |

### Known Limitations

| Limitation | Mitigation |
| ---------- | ---------- |
| Single-instance rate limiter (per-process) | Documented; Redis-backed distributed limiter planned for v2 |
| uint32 envelope size fields (4GB cap) | Agent maxPayloadSize caps at configurable limit (default 1MB) |
| No encryption-at-rest in core | Delegated to storage layer (S3 SSE, R2 encryption) |
| Hash algorithm not configurable | SHA-256 hardcoded per RFC-0000; algorithm agility deferred |

---

## Audit Plan

### Phase 1: Internal Preparation (Current)

Estimated effort: 2 weeks

- [x] Establish security invariants (RFC-0000)
- [x] Implement constant-time comparison
- [x] Implement fail-open semantics with tests
- [x] Implement memory-bounded guarantees
- [x] Document threat model (RFC-0000)
- [x] Create SECURITY.md (vulnerability disclosure policy)
- [x] Add `pnpm audit` to CI pipeline
- [ ] Document all security assumptions
- [ ] Create attack surface inventory
- [ ] Review all error messages for information leakage
- [ ] Verify no PII in logs/audit records

### Phase 2: External Code Review (Q2 2026)

Estimated cost: $15,000-30,000
Estimated duration: 2-3 weeks

**Scope:**

1. **Cryptographic Implementation Review**
   - Hash chain integrity (AuditChain)
   - Constant-time comparison correctness
   - Signature generation determinism
   - Binary envelope format security

2. **Process Isolation Assessment**
   - Child process sandbox escape attempts
   - IPC protocol security (binary length-prefixed)
   - Resource exhaustion via Hound processes
   - SIGTERM/SIGKILL handling edge cases

3. **Memory Safety Analysis**
   - Quarantine eviction correctness under pressure
   - Rate limiter state exhaustion
   - Buffer overflow in binary codec
   - GC-independent lifecycle verification

4. **Input Validation Review**
   - Payload size validation bypass
   - Malformed Scent handling
   - Trust boundary enforcement
   - Cold storage envelope parsing

5. **Fail-Open Verification**
   - All error paths return safe InterceptResult
   - No `process.exit()` in library code
   - FailSafe panic thresholds
   - Graceful degradation under cascading failures

**Recommended Audit Firms:**

| Firm | Specialty | Notes |
| ---- | --------- | ----- |
| Cure53 | Node.js, Web Security | Extensive Node.js audit experience |
| Trail of Bits | Cryptography, Systems | Strong crypto review capabilities |
| Include Security | Application Security | Cost-effective, thorough |
| NCC Group | Enterprise Security | SOC2/compliance focused |

### Phase 3: Penetration Testing (Q3 2026)

Estimated cost: $10,000-25,000
Estimated duration: 1-2 weeks

**Attack Scenarios:**

| Scenario | Target | Description |
| -------- | ------ | ----------- |
| Timing Attack | Signature comparison | Measure timing differential to extract signatures |
| Process Escape | Hound sandbox | Attempt to break out of child process isolation |
| Memory Exhaustion | Quarantine / Rate limiter | Fill buffers to cause OOM or degradation |
| Signature Collision | Evidence deduplication | Find two payloads with same signature |
| Tamper Evasion | AuditChain | Modify audit records without detection |
| Envelope Forgery | THCS binary format | Craft malicious envelope to bypass verification |
| Fail-Open Bypass | FailSafe circuit | Force Tracehound into blocking mode |
| Supply Chain | Dependencies | Exploit uuid or dev dependency vulnerabilities |

### Phase 4: Compliance Certification (Q4 2026+)

Required for Enterprise tier ($999+/mo).

| Certification | Cost Estimate | Timeline |
| ------------- | ------------- | -------- |
| SOC 2 Type I | $30,000-50,000 | 3-6 months |
| SOC 2 Type II | $50,000-80,000 | 6-12 months |
| ISO 27001 alignment | $20,000-40,000 | 3-6 months |
| HIPAA compliance review | $15,000-30,000 | 2-4 months |

---

## Attack Surface Inventory

### External Interfaces

| Interface | Input Source | Validation | Risk |
| --------- | ----------- | ---------- | ---- |
| `Agent.intercept(scent)` | Application code | Payload size check | Medium |
| `IColdStorageAdapter.read()` | External storage | Envelope validation + verify() | High |
| `HoundPool.activate()` | Internal | Process constraints | Medium |
| `S3LikeClient` methods | Network (S3) | Client-provided | High |

### Trust Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│ HOST APPLICATION (Trusted)                                   │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ TRACEHOUND CORE (Security Boundary)                  │    │
│  │                                                      │    │
│  │  Agent ──► Quarantine ──► AuditChain                │    │
│  │    │                                                 │    │
│  │    ▼                                                 │    │
│  │  RateLimiter    EvidenceFactory    Codec             │    │
│  │                                                      │    │
│  │  ┌──────────────────────────────────────────────┐   │    │
│  │  │ QUARANTINE BOUNDARY (Payload Containment)     │   │    │
│  │  │ Raw payloads exist ONLY here                  │   │    │
│  │  └──────────────────────────────────────────────┘   │    │
│  │                                                      │    │
│  │  ┌──────────────────────────────────────────────┐   │    │
│  │  │ PROCESS BOUNDARY (OS-level isolation)         │   │    │
│  │  │ Hound child processes (no eval, no network)   │   │    │
│  │  └──────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────┘    │
│                         │                                    │
│                         ▼                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ COLD STORAGE (External, Untrusted on Read)           │    │
│  │ S3 / R2 / GCS — verify() BEFORE decode()            │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## Security Testing Coverage

### Current Test Categories

| Category | Test Count | Coverage |
| -------- | ---------- | -------- |
| RFC compliance (security invariants) | 15 | Core invariants |
| Constant-time comparison | 12 | All comparison paths |
| Binary codec integrity | 22 | Encode/decode/verify |
| Async codec stress (concurrent) | 10 | Concurrency safety |
| Envelope integrity (adversarial) | 25 | Bit-flip, truncation, corruption |
| Cold storage pipeline (end-to-end) | 7 | Full lifecycle through S3 |
| S3 adapter (failure modes) | 14 | Write/read/delete/errors |
| Fail-safe (circuit breaker) | 13 | Panic thresholds |
| Trust boundary | 11 | Boundary validation |
| Stress / load | 5 | Performance under pressure |

**Total security-relevant tests: ~134 out of 479**

### Recommended Additional Security Tests

| Test | Priority | Description |
| ---- | -------- | ----------- |
| Timing oracle on signature comparison | P0 | Statistical timing analysis |
| Concurrent neutralize race condition | P0 | Parallel neutralize on same evidence |
| Malformed Scent fuzzing | P1 | Random/boundary inputs to intercept() |
| AuditChain fork detection | P1 | Inject records between chain links |
| Rate limiter clock manipulation | P2 | Time-based bypass attempts |
| Hound IPC protocol fuzzing | P2 | Malformed binary messages |

---

## Vendor Communication Template

When engaging an audit firm, provide:

```
Subject: Security Audit Request — Tracehound v1.x

Product: Tracehound — deterministic runtime security buffer
Language: TypeScript (Node.js 20+)
Size: ~5,000 LOC (core), ~8,000 LOC (tests)
Dependencies: 1 runtime (uuid), standard Node.js built-ins
Architecture: Monorepo (core + adapters), child process isolation

Key areas:
1. Cryptographic operations (SHA-256, constant-time comparison)
2. Process isolation (child process sandbox)
3. Memory-bounded data structures (quarantine, rate limiter)
4. Binary wire format (THCS envelope)
5. Fail-open error handling

Existing documentation:
- RFC-0000 (core architecture and threat model)
- Security invariant test suite (134 tests)
- Fail-open specification
- Evidence lifecycle policy

Desired deliverables:
- Vulnerability report with severity ratings
- Code review findings
- Remediation recommendations
- Executive summary suitable for customer-facing use
```

---

## Post-Audit Actions

After receiving audit results:

1. **Critical/High findings**: Fix within 30 days, release patch
2. **Medium findings**: Fix within 90 days, include in next minor release
3. **Low/Informational**: Triage and schedule as appropriate
4. **Publish**: Security advisory for any user-impacting findings
5. **Document**: Add audit report summary to public documentation
6. **Badge**: Display "Security Audited by [Firm]" in README

---

**Last Updated:** 2026-02-10
