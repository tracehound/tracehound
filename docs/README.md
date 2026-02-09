# Documentation Index

> **Last Updated:** 2026-02-10
> **Version:** v1.0.0 Stable
> **Model:** Open-Core (Substrate: OSS, Satellites: Commercial)

---

## Quick Links

| Category          | Document                                         | Purpose                    |
| ----------------- | ------------------------------------------------ | -------------------------- |
| **Start Here**    | [GETTING-STARTED.md](./GETTING-STARTED.md)       | Installation & quick start |
| **Configuration** | [CONFIGURATION.md](./CONFIGURATION.md)           | All config options         |
| **API**           | [API.md](./API.md)                               | Public API reference       |
| **Pricing**       | [PRICING.md](./PRICING.md)                       | Open-Core model            |
| **Strategy**      | [OPEN_CORE_STRATEGY.md](./OPEN_CORE_STRATEGY.md) | Licensing rationale        |

---

## Specification Documents

| Document                                                       | Status       | Description                    |
| -------------------------------------------------------------- | ------------ | ------------------------------ |
| [FAIL-OPEN-SPEC.md](./FAIL-OPEN-SPEC.md)                       | ✅ Normative | Failure behavior, panic levels |
| [PERFORMANCE-SLA.md](./PERFORMANCE-SLA.md)                     | ✅ Normative | Latency guarantees (p50/p99)   |
| [LOCAL-STATE-SEMANTICS.md](./LOCAL-STATE-SEMANTICS.md)         | ✅ Normative | Per-instance isolation         |
| [COLD-STORAGE-SECURITY.md](./COLD-STORAGE-SECURITY.md)         | ✅ Normative | mTLS, encryption-at-rest       |
| [EVIDENCE-LIFECYCLE-POLICY.md](./EVIDENCE-LIFECYCLE-POLICY.md) | ✅ Normative | Retention, eviction, GDPR      |

---

## RFCs (Request for Comments)

| RFC                                                    | Status         | Topic                               |
| ------------------------------------------------------ | -------------- | ----------------------------------- |
| [0000-Proposal.md](./rfc/0000-Proposal.md)             | 🔒 Locked      | Core architecture (normative)       |
| [0001-SecurityState.md](./rfc/0001-SecurityState.md)   | ✅ Implemented | Unified state substrate             |
| [0002-Argos.md](./rfc/0002-Argos.md)                   | 📋 Planned     | Runtime observer (separate product) |
| [0003-Talos.md](./rfc/0003-Talos.md)                   | 📋 Planned     | Talos — policy-driven response      |
| [0004-Muninn.md](./rfc/0004-Muninn.md)                 | 📋 Planned     | Muninn — threat metadata substrate  |
| [0005-Huginn.md](./rfc/0005-Huginn.md)                 | 📋 Planned     | Huginn — external threat feeds      |
| [0006-Heimdall.md](./rfc/0006-Heimdall.md)             | 📋 Planned     | Heimdall — supply chain security    |
| [0007-Loki.md](./rfc/0007-Loki.md)                     | 📋 Planned     | Loki — passive deception & tarpit   |
| [0008-RustCorePivot.md](./rfc/0008-RustCorePivot.md)   | 📋 Planned     | Rust core pivot strategy            |

---

## Planning & Strategy

| Document                                         | Status       | Description                          |
| ------------------------------------------------ | ------------ | ------------------------------------ |
| [ROADMAP.md](./ROADMAP.md)                       | ✅ Active    | Development phases & timeline        |
| [STRATEGY.md](./STRATEGY.md)                     | ✅ Active    | GTM strategy & market analysis       |
| [NAMING.md](./NAMING.md)                         | 📚 Reference | Product naming convention            |
| [PRESENTATION-PREP.md](./PRESENTATION-PREP.md)   | 📚 Reference | Investor/demo preparation notes      |

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
