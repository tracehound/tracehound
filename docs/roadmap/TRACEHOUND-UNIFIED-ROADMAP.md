# Tracehound Unified Roadmap v2 (Authoritative Technical Source)

> **Status:** Active
> **Last Updated:** 2026-03-03
> **Scope:** Technical roadmap only (milestone-based, no calendar binding)
> **Authoritative Source:** This document is the single technical source of truth for roadmap execution.

---

## 1. Locked Decisions

1. `docs/roadmap` is the primary technical roadmap area.
2. `internal/ROADMAP.md` is preserved as legacy context and is no longer an active technical roadmap.
3. GTM and pricing remain in internal strategy documents and are out of scope for this roadmap.
4. `@tracehound/horizon` remains external to this monorepo.
5. Horizon expansion priority is fixed:
   - interop contract
   - fail-open compatibility
   - Redis sync reliability
   - then enterprise extras (`mTLS`, policy broker)

---

## 2. Canonical Baseline Facts (M0 Freeze)

| Fact | Canonical Source | Value |
| --- | --- | --- |
| Current workspace version | `package.json` | `1.4.4` |
| Latest core changelog release | `packages/core/CHANGELOG.md` | `1.4.4` on `2026-02-26` |
| Legacy internal roadmap marker | `internal/ROADMAP.md` | Reports `v1.2.0` (stale for active planning) |
| Argos status (technical planning) | `docs/README.md`, `docs/rfc/0002-Argos.md` | `Planned` / `Draft` |
| Horizon package availability in monorepo | `pnpm-workspace.yaml`, `packages/*` | Not present |

### Contradiction Matrix

| Topic | Legacy Statement | Canonical Resolution |
| --- | --- | --- |
| Product status | `internal/ROADMAP.md` indicates `v1.2.0 stable` | Roadmap planning must use `v1.4.4` baseline |
| Argos maturity | Legacy claims "approved" | Treated as planned/draft until governance status changes |
| Horizon footprint | Appears as feature unlock in docs | Treated as external product and planned integration contract only |

---

## 3. Source Modules in `docs/roadmap`

These documents remain valuable and are treated as source modules:

1. [ENHANCED-QUARANTINE-PROTOCOL.md](./ENHANCED-QUARANTINE-PROTOCOL.md)
2. [RESILIENCE-EDGE-V2.md](./RESILIENCE-EDGE-V2.md)
3. [PILOT-PROGRAM-2026.md](./PILOT-PROGRAM-2026.md)

Usage rule:

1. Module-specific risks and analysis stay in source modules.
2. Cross-module sequencing, status, and execution gates are maintained only in this unified roadmap.

---

## 4. Capability Status Taxonomy

Every roadmap claim must use one of these labels:

| Label | Meaning |
| --- | --- |
| `Implemented` | Available in this repository and validated by tests/docs |
| `External` | Exists outside this repository and is consumed through explicit contracts |
| `Planned` | Not implemented yet; tracked as roadmap intent |

Boundary rule:

1. No claim may stay unlabeled.
2. `Horizon` and satellite products must be explicitly marked `External` or `Planned`.

---

## 5. Horizon External Boundary and Coordination Contract

Horizon is modeled as an external integration contract. This repo owns the contract surface, invariants, and fallback semantics.

### Proposed Contract Types (Roadmap-Level Specification)

```ts
export type CoordinationFeature =
  | 'shared_blocklist'
  | 'global_rate_limit'
  | 'mtls_enforcement'
  | 'policy_broker'

export interface CoordinationHealth {
  mode: 'local' | 'degraded' | 'synchronized'
  lastSyncAt: number | null
  syncLagMs: number | null
  provider: string
}

export interface CoordinationProvider {
  readonly providerId: string
  readonly features: ReadonlySet<CoordinationFeature>
  start(): Promise<void>
  stop(): Promise<void>
  health(): CoordinationHealth
  syncBlocklist?(entries: ReadonlyArray<string>): Promise<void>
  syncRateLimit?(bucketKey: string, value: number): Promise<void>
}
```

### Invariants

1. Local-only core behavior stays default when no coordination provider exists.
2. Coordination failures never crash host applications (fail-open preserved).
3. No hidden side-effect import pattern is treated as normative contract.
4. Security-critical semantics remain deterministic under provider degradation.

---

## 6. Integrated Technical Delta from Legacy Internal Roadmap (M2 Intake)

### Satellite Track (Planned)

| Component | Status | Technical Scope |
| --- | --- | --- |
| Argos | Planned (`Draft`) | Runtime behavioral observation as standalone product |
| Talos | Planned | External policy-driven response executor |
| Huginn | Planned | Threat intelligence ingestion and normalization |
| Muninn | Planned | Historical ledger and aggregation |
| Heimdall | Planned | Supply chain telemetry and CI/CD security integration |
| Loki | Planned | Passive deception and tarpit layer for adversarial friction |

### Deferred Tracks (RFC Required)

The following tracks are intentionally deferred in this unified technical roadmap until formal RFCs are authored:

| Component | Status | Activation Condition |
| --- | --- | --- |
| Norns | Deferred | Add RFC and security/performance contract |
| Furies | Deferred | Add RFC and adversarial validation contract |
| Watchtower | Deferred | Add RFC and control-plane boundary contract |

### Enterprise Integration Track (Planned)

| Capability | Status | Notes |
| --- | --- | --- |
| Multi-instance coordination | Planned | Contract-first, no direct core hard dependency |
| SIEM exporters | Planned | Technical integrations only, vendor partnerships out of scope |
| Instance telemetry expansion | Planned | Reliability and observability alignment |
| Compliance report automation | Planned | Follows security audit gates |

### Multi-Runtime Track

| Runtime | Status | Notes |
| --- | --- | --- |
| Node.js / TypeScript | Implemented | Current production baseline |
| Rust core pivot | Planned | Governed by RFC-0008 direction |
| Python / Go / other ports | Planned | Post-contract and reliability maturity |

---

## 7. Milestones (M0-M5, Milestone-Only)

### M0 - Canonical Baseline Freeze

Deliverables:

1. Unified facts table (version, RFC status, package availability).
2. Contradiction matrix approved for technical planning.

Exit criteria:

1. No unresolved baseline conflicts for roadmap references.

### M1 - Unified Master Roadmap Activation

Deliverables:

1. This file as single technical roadmap source.
2. Source modules linked and scoped.

Exit criteria:

1. All cross-module sequencing decisions maintained here only.

### M2 - Internal Technical Delta Intake

Deliverables:

1. Legacy internal technical backlog mapped into unified roadmap.
2. GTM and pricing explicitly excluded from technical milestones.

Exit criteria:

1. Technical backlog is clear without commercial mixing.

### M3 - Horizon Expansion Track (External Contract)

Deliverables:

1. External boundary statement and capability taxonomy alignment.
2. Coordination contract proposal and reliability-first ordering.

Exit criteria:

1. Horizon claims are labeled `Implemented` / `External` / `Planned`.
2. Fail-open compatibility is explicit and testable.

### M4 - Security Audit Track Alignment

Deliverables:

1. Security audit phases mapped to technical milestones.
2. Release-readiness gates connected to audit evidence requirements.

Exit criteria:

1. Audit planning and roadmap closure criteria are aligned.

### M5 - Legacy Deprecation and Redirect

Deliverables:

1. Legacy roadmap marked deprecated with redirect to this file.
2. Team-facing pointer consolidated to one authoritative technical source.

Exit criteria:

1. Active execution references this file, not legacy roadmap.

---

## 8. Security Audit Alignment Map (M4)

Reference: [internal/SECURITY-AUDIT.md](../../internal/SECURITY-AUDIT.md)

| Security Audit Phase | Unified Milestone Binding | Closure Signal |
| --- | --- | --- |
| Phase 1: Internal Preparation | M0-M2 | Invariants and assumptions aligned to baseline facts |
| Phase 2: External Code Review | M3-M4 | External review scope reflects current architecture boundaries |
| Phase 3: Penetration Testing | M4 | Technical release-readiness includes adversarial validation |
| Phase 4: Compliance Certification | M4-M5 | Compliance planning tied to roadmap closure evidence |

---

## 9. Validation and Acceptance Scenarios

1. `Consistency Test`: Version, RFC status, and package availability match canonical sources.
2. `Claim Boundary Test`: Horizon and satellite statements are always labeled.
3. `Governance Test`: Locked RFCs are unchanged; new architecture work routes to new RFCs.
4. `Readability Test`: Technical roadmap excludes GTM/pricing content.
5. `Fail-Open Contract Test`: Coordination unavailability preserves host survivability.

---

## 10. Governance and RFC Rules

1. RFC-0000 remains locked and untouched.
2. New architectural decisions require new RFCs under standard governance lifecycle.
3. This roadmap may define direction, but implementation authority still requires RFC and test evidence where applicable.

---

## 11. Out of Scope for This Document

1. Pricing tiers, revenue model, and package monetization.
2. Influencer strategy and marketing channel execution.
3. Partnership and GTM operations.

These remain in `internal` strategy artifacts.

---

## 12. Reference Documents

1. [ENHANCED-QUARANTINE-PROTOCOL.md](./ENHANCED-QUARANTINE-PROTOCOL.md)
2. [RESILIENCE-EDGE-V2.md](./RESILIENCE-EDGE-V2.md)
3. [PILOT-PROGRAM-2026.md](./PILOT-PROGRAM-2026.md)
4. [internal/ROADMAP.md](../../internal/ROADMAP.md)
5. [internal/SECURITY-AUDIT.md](../../internal/SECURITY-AUDIT.md)
6. [docs/README.md](../README.md)
7. [docs/rfc/0002-Argos.md](../rfc/0002-Argos.md)
8. [docs/rfc/0007-Loki.md](../rfc/0007-Loki.md)
9. [docs/rfc/0008-RustCorePivot.md](../rfc/0008-RustCorePivot.md)
10. [docs/rfc/0009-CoordinationProviderContract.md](../rfc/0009-CoordinationProviderContract.md)
11. [docs/rfc/0010-OneWayMembrane.md](../rfc/0010-OneWayMembrane.md)
12. [docs/rfc/0011-PressureContainment.md](../rfc/0011-PressureContainment.md)
13. [SPRINT-BOOTSTRAP-GOVERNANCE-PACK.md](./SPRINT-BOOTSTRAP-GOVERNANCE-PACK.md)
