# Invariants

This document defines measurable security invariants.

## Invariant Register

| ID     | Invariant                                                                      | Why It Matters                                       | Current Evidence                                           | Status      |
| ------ | ------------------------------------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------- | ----------- |
| INV-01 | **No-threat scent must not be quarantined.** (If `scent.threat` is null/empty) | Prevents business-logic bypass and false quarantines | `Agent.intercept` flow + unit tests in core                | In progress |
| INV-02 | **Threat scent must pass through factory before quarantine.**                  | Ensures single ownership of hash/signature           | `EvidenceFactory.create` usage inside Agent                | In progress |
| INV-03 | **Payload over configured limit must be rejected.**                            | Reduces memory exhaustion risk                       | `encodePayload(..., maxSize)` + payload-too-large handling | In progress |
| INV-04 | **Same canonical payload + same category => same signature.**                  | Forensic determinism                                 | canonical JSON + SHA-256 + consistency tests               | In progress |
| INV-05 | **Duplicate signature must not create duplicate quarantine state.**            | Limits storage abuse and replay effects              | `quarantine.has` + duplicate handling path                 | In progress |
| INV-06 | **External detector trust must not be silently promoted.**                     | Risks trust-boundary escalation                      | `validateTrustBoundary` rules                              | In progress |
| INV-07 | **Hound process code-generation-from-strings disabled.**                       | Minimizes RCE surface                                | process adapter runtime flags                              | In progress |

## Validation Mapping

- **Code evidence:** core flow and boundary modules (`agent`, `evidence-factory`, `encode`, `trust-boundary`, `process-adapter`)
- **Existing tests to map:** consistency, trust-boundary, tracehound, and codec tests
- **Open need:** specific test name + artifact output for each invariant (`security/artifacts/*.md`)

## Ownership & Target Dates (Program Baseline)

| ID     | Owner           | Target Sprint | Target Date (placeholder) | Planned Decision Path |
| ------ | --------------- | ------------- | ------------------------- | --------------------- |
| INV-01 | Core Maintainer | Sprint 1      | 2026-03-06                | pass                  |
| INV-02 | Core Maintainer | Sprint 1      | 2026-03-06                | pass                  |
| INV-03 | Core Maintainer | Sprint 1      | 2026-03-06                | pass                  |
| INV-04 | Security + Core | Sprint 1      | 2026-03-06                | pass                  |
| INV-05 | Core Maintainer | Sprint 1      | 2026-03-06                | pass                  |
| INV-06 | Security Lead   | Sprint 1      | 2026-03-06                | pass/risk-accepted    |
| INV-07 | Core + Platform | Sprint 1      | 2026-03-06                | pass/risk-accepted    |

Status transitions to final `pass/fail/risk-accepted` are tracked in `security/artifacts/invariant-mapping.md`.

## Exit Criteria

- [ ] Each invariant linked to at least one test/analysis output.
- [ ] Updated "In progress" statuses to `pass/fail/risk-accepted`.
- [ ] Defined owner and target completion date for INV-01..INV-07.
