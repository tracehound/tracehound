# Fuzz Assurance Report Model

## Objective

Deliver audit-grade assurance for deterministic security invariants **without** coverage-guided fuzzers.

## Assurance Strategy

1. **Primary semantic fuzz:** deterministic property-based fuzzing harness (fast-check-equivalent) for deterministic invariants.
2. **Versioned adversarial corpus:** curated replayable seeds under `security/corpus/`.
3. **Structural parser stress:** malformed framing/partial payload replay.
4. **State-machine adversarial checks:** append permutation, partial failure ordering, duplicate replay, fork/rollback attempts.

## Required Invariants

- Determinism
- Canonical idempotency
- Integrity enforcement
- Bounded failure
- State non-amplification
- Duplicate stability
- IPC logical safety

See `security/invariants.md` for invariant IDs and test mapping.

## Assurance Metrics (Coverage-Independent)

| Metric                          | Target |
| ------------------------------- | ------ |
| Invariant violation count       | `0`    |
| Unresolved crash count          | `0`    |
| State corruption findings       | `0`    |
| Bounded failure preservation    | pass   |
| Corpus classes covered          | all    |
| Reproducibility (seed + replay) | pass   |

## Corpus Lifecycle

For each finding: **detect → minimize → classify → persist → replay in CI**.

Seed classes:

- invariant seeds
- boundary seeds
- regression seeds
- crash seeds (if any)

## CI Integration

- **Regression (every PR):** replay corpus deterministically (`test:fuzz:regression`).
- **Assurance (nightly):** property fuzz + corpus replay with bounded runtime (`test:fuzz:assurance`).

Failure conditions:

- invariant violation
- non-deterministic output
- state drift
- unbounded resource behavior

## Linked Artifacts

- `security/artifacts/fuzz-corpus-summary.md`
- `security/artifacts/fuzz-assurance-report.md`
- `security/artifacts/generated/fuzz-assurance-metrics.json`
- `security/artifacts/generated/fuzz-regression-metrics.json`
- `security/artifacts/fuzz-failure-lifecycle.md`

## Phase 4 Evidence

- Property suite: `packages/core/tests/fuzz/state-machine-adversarial.property.test.ts`
- Corpus replay seeds: permutation ordering, partial failure ordering, fork rollback attempt

## Phase 6 Automation

- Lifecycle records are maintained by `scripts/record-fuzz-failure.mjs`.
- Lifecycle ledger path: `security/artifacts/generated/fuzz-failures.json`.
- Logs regenerated on each lifecycle update: failure log, minimization log, regression seeds.

## Phase 7 Gate Enforcement

- `pnpm assurance:gate:regression` is executed in PR regression CI and fails on unresolved lifecycle records.
- `pnpm assurance:gate` is executed in nightly assurance CI and fails on unresolved lifecycle records.
- Gate source of truth: `security/artifacts/generated/fuzz-failures.json`.
