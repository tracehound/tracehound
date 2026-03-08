# Deferred Investigation Note: Forensic Integrity & Test Hardening

> **Status:** Deferred (next release cycle intake)
> **Created:** 2026-03-08
> **Owner:** Core engineering backlog
> **Intent:** Start a dedicated analysis and implementation track in a future cycle.

---

## Context

This note captures two related hardening topics that are intentionally deferred from the current TLS/cipher-suite execution scope:

1. Forensic metadata immutability and tamper-evidence depth.
2. Test hardening with strict TypeScript enforcement across core tests.

Both topics are high-value for assurance posture, but are not treated as current release blockers.

---

## Topic A: Forensic Metadata Immutability

### Concern

`ScentSource` metadata currently has mutation surface through object-reference flow.  
Current AuditChain guarantees are strong for lifecycle/hash continuity, but metadata immutability guarantees should be evaluated explicitly before claiming full forensic context tamper-evidence.

### Investigation Goals

1. Verify all source metadata paths for reference leakage and post-capture mutation risk.
2. Define deterministic immutable snapshot strategy for metadata captured into Evidence.
3. Decide whether and how metadata integrity (`sourceDigest` or equivalent) must be sealed in AuditChain event material.
4. Evaluate backward compatibility impact and migration requirements.

### Expected Deliverables

1. Threat model and abuse-case matrix.
2. Design proposal (RFC if interface or audit semantics change).
3. Implementation plan with compatibility and rollout strategy.
4. Regression and adversarial test set for metadata integrity.

---

## Topic B: Test Hardening (Strict TypeScript)

### Concern

A full strict test typecheck gate (`tsconfig.tests.json`) exposes existing typing debt across test suites.  
This is valuable for contract safety, but broad immediate enforcement can block release velocity.

### Investigation Goals

1. Define staged rollout plan for strict test typing without disrupting short-cycle releases.
2. Prioritize high-risk suites first (core security and lifecycle paths).
3. Establish a stable CI policy for when strict test typecheck becomes mandatory.
4. Track and burn down remaining typing debt by batch.

### Expected Deliverables

1. Phased hardening plan with clear acceptance criteria per stage.
2. Per-suite debt inventory and sequencing.
3. Final gate definition for strict test typecheck adoption.

---

## Execution Trigger (Future Cycle)

Start this work when current TLS/cipher-suite objectives are complete and release risk is acceptable for a hardening-focused iteration.
