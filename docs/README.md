# Documentation Index

> **Last Updated:** 2026-03-07
> **Version:** v1.7.0
> **Model:** Open-Core (Substrate: OSS, Satellites: Commercial)

---

## Quick Links

| Category          | Document                                                                                   | Purpose                                          |
| ----------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| **Start Here**    | [GETTING-STARTED.md](./GETTING-STARTED.md)                                                 | Installation & quick start                       |
| **API**           | [API.md](./API.md)                                                                         | Public API reference                             |
| **Configuration** | [CONFIGURATION.md](./CONFIGURATION.md)                                                     | Runtime and adapter configuration defaults       |
| **Migration**     | [BREAKING-CHANGES.md](./BREAKING-CHANGES.md)                                               | Breaking changes and upgrade path                |
| **Roadmap**       | [roadmap/TRACEHOUND-UNIFIED-ROADMAP.md](./roadmap/TRACEHOUND-UNIFIED-ROADMAP.md)           | Authoritative technical roadmap                  |
| **Remediation**   | [CRITICAL-SECURITY-REMEDIATION-PLAN.md](./CRITICAL-SECURITY-REMEDIATION-PLAN.md)           | Active plan for verified critical security gaps  |
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

`docs/rfc/` contains only the normative RFC set.

| RFC                                                                                        | Status    | Topic                                                     |
| ------------------------------------------------------------------------------------------ | --------- | --------------------------------------------------------- |
| [0000-Proposal.md](./rfc/0000-Proposal.md)                                                 | 🔒 Locked | Core architecture (normative)                             |
| [0009-CoordinationProviderContract.md](./rfc/0009-CoordinationProviderContract.md)         | ✅ Stable | External coordination contract                            |
| [0010-OneWayMembrane.md](./rfc/0010-OneWayMembrane.md)                                     | ✅ Stable | One-way membrane and trace id signaling                   |
| [0011-PressureContainment.md](./rfc/0011-PressureContainment.md)                           | ✅ Stable | Pressure containment and graceful shielding               |
| [0013-OperationalTruthAndHoundAnalysis.md](./rfc/0013-OperationalTruthAndHoundAnalysis.md) | ✅ Stable | Signed operational truth and deterministic hound analysis |

---

## Roadmap

`docs/roadmap/TRACEHOUND-UNIFIED-ROADMAP.md` is the only active roadmap.
`ENHANCED-QUARANTINE-PROTOCOL.md` is now a completed implementation record for the core quarantine expansion.
Other roadmap files remain historical reference material unless restated in the unified roadmap.

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
