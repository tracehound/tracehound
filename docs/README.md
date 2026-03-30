# Documentation Index

> **Last Updated:** 2026-03-30
> **Version:** v1.8.10
> **Model:** Open-Source

---

## Quick Links

| Category          | Document                                                                                   | Purpose                                          |
| ----------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| **Start Here**    | [GETTING-STARTED.md](./GETTING-STARTED.md)                                                 | Installation & quick start                       |
| **API**           | [API.md](./API.md)                                                                         | Public API reference                             |
| **Configuration** | [CONFIGURATION.md](./CONFIGURATION.md)                                                     | Runtime and adapter configuration defaults       |
| **Migration**     | [BREAKING-CHANGES.md](./BREAKING-CHANGES.md)                                               | Breaking changes and upgrade path                |
| **Supply Chain**  | [../security/supply-chain.md](../security/supply-chain.md)                                 | Release trust boundary and build provenance      |
| **Harness**       | [../security/HARNESS.md](../security/HARNESS.md)                                           | External harness boundary and local forensic lab |
| **Validation**    | [../security/paranoid-validation-playbook.md](../security/paranoid-validation-playbook.md) | Deep security review and release validation path |

---

## Specification Documents

| Document                                                       | Status       | Description                     |
| -------------------------------------------------------------- | ------------ | ------------------------------- |
| [FAIL-OPEN-SPEC.md](./FAIL-OPEN-SPEC.md)                       | ✅ Normative | Failure behavior, panic levels  |
| [PERFORMANCE-SLA.md](./PERFORMANCE-SLA.md)                     | ✅ Normative | Latency guarantees (p50/p99)    |
| [LOCAL-STATE-SEMANTICS.md](./LOCAL-STATE-SEMANTICS.md)         | ✅ Normative | Per-instance isolation          |
| [COLD-STORAGE-SECURITY.md](./COLD-STORAGE-SECURITY.md)         | ✅ Normative | mTLS, encryption-at-rest        |
| [EVIDENCE-LIFECYCLE-POLICY.md](./EVIDENCE-LIFECYCLE-POLICY.md) | ✅ Normative | Retention, eviction, GDPR       |
| [SECURITY-ASSURANCE.md](./SECURITY-ASSURANCE.md)               | ✅ Reference | SecOps resilience & chaos tests |

---

## RFCs (Request for Comments)

`docs/rfc/` contains authoritative RFC set.

| RFC                                                                                        | Status         | Topic                                                     |
| ------------------------------------------------------------------------------------------ | -------------- | --------------------------------------------------------- |
| [0000-Proposal.md](./rfc/0000-Proposal.md)                                                 | 🔒 Locked      | Core architecture (normative)                             |
| [0009-CoordinationProviderContract.md](./rfc/0009-CoordinationProviderContract.md)         | ✅ Implemented | External coordination contract                            |
| [0010-OneWayMembrane.md](./rfc/0010-OneWayMembrane.md)                                     | ✅ Implemented | One-way membrane and trace id signaling                   |
| [0011-PressureContainment.md](./rfc/0011-PressureContainment.md)                           | ✅ Implemented | Pressure containment and graceful shielding               |
| [0013-OperationalTruthAndHoundAnalysis.md](./rfc/0013-OperationalTruthAndHoundAnalysis.md) | ✅ Implemented | Signed operational truth and deterministic hound analysis |
| [0015-ExternalThreatSignalAdapters.md](./rfc/0015-ExternalThreatSignalAdapters.md)         | ⚠️ Draft       | Public draft for external threat signal adapter contract  |

---

## Release Boundary

Tracehound `v1.8.10` treats release provenance as a first-class security boundary:

- Release gate: immutable lockfile, offline/clean install, `pnpm build`, package parity verification, artifact manifest metadata
- Security/tooling gate: tests, coverage, chaos, forensic lab, SBOM, audit and CVE triage
- `vite`, `vitest`, `tsx`, and optional bundlers remain developer/test tooling, not trusted release-build inputs
- `docs/` in this repository is the canonical OSS source; external sites consume and mirror this material

## Validation Lanes

- `pnpm test` validates package behavior and regression coverage.
- `pnpm test:chaos` validates fail-open, pressure, snapshot, and trace-registry invariants.
- `pnpm test:forensic-lab` validates evidence/custody parity, signed snapshot truth, and cold-storage readback.
- `infrastructure/soak` remains the sustained-traffic lane for audit continuity and operational truth.

---

## Legend

| Status         | Meaning                                     |
| -------------- | ------------------------------------------- |
| ✅ Normative   | Authoritative specification                 |
| ✅ Implemented | Design complete and in codebase             |
| ✅ Active      | Living document, regularly updated          |
| 📋 Planned     | Future work, not yet implemented            |
| ⚠️ Draft       | Work in progress, may contain outdated info |
| 📦 Archive     | Historical reference only                   |
| 🔒 Locked      | Cannot be changed without RFC process       |
| 📚 Reference   | Informational, not normative                |
