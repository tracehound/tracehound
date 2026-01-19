# Documentation Index

> **Last Updated:** 2026-01-19
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
| [0003-ThreatLedger.md](./rfc/0003-ThreatLedger.md)     | 📋 Planned     | Muninn - threat metadata archive    |
| [0004-ResponseEngine.md](./rfc/0004-ResponseEngine.md) | 📋 Planned     | Talos - policy-driven response      |
| [0005-ThreatIntel.md](./rfc/0005-ThreatIntel.md)       | 📋 Planned     | Huginn - external threat feeds      |

---

## Planning & Strategy

| Document                               | Status       | Description                        |
| -------------------------------------- | ------------ | ---------------------------------- |
| [ROADMAP.md](./ROADMAP.md)             | ✅ Active    | Development phases & timeline      |
| [TARGET-MARKET.md](./TARGET-MARKET.md) | ⚠️ Draft     | Market analysis (pricing outdated) |
| [NAMING.md](./NAMING.md)               | 📚 Reference | Product naming convention          |

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
