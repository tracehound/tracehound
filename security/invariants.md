# Invariants

This register defines deterministic security invariants verified by fuzz/property campaigns.

## Invariant Register

| ID         | Invariant (MUST)                                                                                    | Observable State / Outcome                           | Evidence Linkage                                                                          | Status |
| ---------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------ |
| INV-DET-01 | **Determinism:** identical byte-equivalent input MUST yield identical hash/signature/state outcome. | signature, canonical bytes, intercept status         | `determinism.property.test.ts`, `state-machine-adversarial.property.test.ts`, corpus pair | pass   |
| INV-DET-02 | **Canonical idempotency:** `canonical(canonical(x)) == canonical(x)` MUST hold.                     | canonical JSON string and encoded size               | `canonical-idempotency.property.test.ts`                                                  | pass   |
| INV-DET-03 | **Integrity enforcement:** mutation between sign → verify MUST be detected.                         | signature comparison mismatch                        | `integrity-enforcement.property.test.ts`                                                  | pass   |
| INV-DET-04 | **Bounded failure:** malformed/oversized input MUST NOT mutate quarantine/chain.                    | quarantine `count/bytes`, no unbounded parser growth | `bounded-failure.property.test.ts`                                                        | pass   |
| INV-DET-05 | **State non-amplification:** rejected input MUST NOT grow quarantine/chain/pool.                    | same stats before/after rejection                    | fuzz property + state-machine fuzz + corpus replay                                        | pass   |
| INV-DET-06 | **Duplicate stability:** duplicate signature MUST NOT create duplicate state.                       | first quarantined, second ignored, stable count      | `duplicate-stability.property.test.ts`, `state-machine-adversarial.property.test.ts`      | pass   |
| INV-DET-07 | **IPC safety (logical):** malformed IPC frame MUST NOT corrupt parser state.                        | parser buffered bytes bounded/reset on bad frame     | `ipc-safety.property.test.ts`                                                             | pass   |

## Validation Mapping

- Code evidence: `encode`, `signature`, `agent`, `quarantine`, `hound-ipc`.
- Replay evidence: versioned corpus under `security/corpus/` with deterministic replay in CI.
- Program artifacts: `security/artifacts/fuzz-assurance-report.md`, `security/artifacts/fuzz-corpus-summary.md`.

## Exit Criteria

- [x] Every invariant mapped to executable property/replay checks.
- [x] Deterministic seed and reproducibility requirements documented.
- [x] Artifact linkage updated for audit evidence.
