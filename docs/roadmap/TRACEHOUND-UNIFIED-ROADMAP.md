# Tracehound Unified Roadmap (Active Technical Roadmap)

> **Status:** Active
> **Last Updated:** 2026-03-07
> **Scope:** OSS product direction and real-world validation
> **Authoritative Source:** This is the only active technical roadmap in `docs/roadmap`.

---

## 1. Operating Decisions

1. This file is the only active execution roadmap.
2. Other documents in `docs/roadmap/` are retained either as completed implementation records or archived reference material, not active delivery plans.
3. Tracehound remains OSS-first.
4. Real-world validation now takes priority over further roadmap decomposition and lab-only planning.
5. Security-lead or Platform/SRE sign-off is not a release blocker for OSS progress.
6. Soak testing remains valuable as a confidence-building activity, but is not a mandatory blocker for every release.
7. Docs-weighted or minimal-change releases do not require a full harness refresh by default.
8. `@tracehound/horizon` remains external to this monorepo.

---

## 2. Canonical Baseline

| Fact | Canonical Source | Value |
| --- | --- | --- |
| Current workspace version | `package.json` | `1.7.0` |
| Latest core changelog release | `packages/core/CHANGELOG.md` | `1.7.0` (`2026-03-07`) |
| Current release character | repo state | Docs-weighted / minimal code-change release |
| Legacy internal roadmap | `internal/ROADMAP.md` | Deprecated; historical context only |
| Latest harness decision baseline | `tracehound-security-harness/test-results/v1.6.0/go-no-go.md` | Pre-soak green for `v1.6.0`; useful historical evidence, not current release authority |
| Horizon package availability in monorepo | `pnpm-workspace.yaml`, `packages/*` | Not present |

---

## 3. Current Position

| Track | Status | Meaning |
| --- | --- | --- |
| M0-M3 historical governance work | Completed | Baseline, unified roadmap, backlog intake, and contract-first governance work are done. |
| Enhanced quarantine protocol | Completed | Core membrane, pressure containment, TTL decay/archive, and audit custody expansion are in the codebase. |
| M4 field validation and OSS adoption | In Progress | The active focus is real-world learning, operator usability, and deployment confidence. |
| M5 roadmap consolidation | Completed | Legacy roadmap redirect exists; roadmap authority is consolidated here. |

Interpretation:

1. We are no longer blocked on more roadmap drafting.
2. We are no longer treating audit-package completion as the main product narrative.
3. The next useful signal must come from real deployments, OSS users, and production-like operating experience.

---

## 4. Active Roadmap

### Now

Goal: move from lab confidence to real-world OSS validation with minimal planning overhead.

1. Keep this file as the only active roadmap.
2. Collapse roadmap sprawl by treating other roadmap documents as archived reference inputs.
3. Run soak when useful, but treat it as confidence evidence rather than a universal ship gate.
4. Gather OSS field feedback:
   - install friction
   - configuration friction
   - false-positive containment noise
   - restart and upgrade survivability
   - incident reconstruction usefulness
5. Prefer real issue intake, operator notes, and field reports over creating new roadmap sub-documents.
6. Keep release discipline lightweight for docs-weighted or minimal-code releases.

### Next

Goal: improve operational trust based on real usage rather than hypothetical planning.

1. Tighten onboarding and operator documentation around first deployment.
2. Improve evidence usability for incident review and support workflows.
3. Validate restart, rotation, partial-failure, and upgrade paths under real or production-like conditions.
4. Reduce benign traffic containment noise.
5. Continue contract-first coordination work only where it supports real adopters.

### Later

Goal: expand only after field evidence justifies it.

1. Horizon coordination maturity and multi-instance workflows.
2. Satellite products (`Argos`, `Talos`, `Huginn`, `Muninn`, `Heimdall`, `Loki`, `Watchtower`) as separate or external tracks.
3. Rust or multi-runtime expansion after the Node.js / TypeScript path has enough operational signal.

---

## 5. Release and Validation Stance

1. Lab evidence remains useful, but it is no longer the sole proof of progress.
2. Harness outputs should be treated as supporting evidence, not the only release authority.
3. For OSS releases:
   - code changes require normal engineering validation
   - docs-only or minimal releases can move without full adversarial reruns
4. Soak testing is recommended when release risk, platform shifts, or runtime changes justify it.
5. External audit readiness remains a possible later activity, not the current roadmap center of gravity.

---

## 6. Capability Horizon

| Area | Status | Notes |
| --- | --- | --- |
| Node.js / TypeScript core | Implemented | Current production baseline |
| Enhanced quarantine expansion | Implemented | Membrane, raw-ingress hashing preference, TTL decay, archival fallback, and batched audit custody are live |
| Real-world OSS validation | In Progress | Active priority |
| Soak testing | Optional | Confidence activity; not universal blocker |
| External audit program | Optional Later | Not current execution driver |
| Horizon coordination contract | Planned | Contract-first, external boundary preserved |
| Enterprise integrations | Planned | Pursue only when field demand is concrete |
| Satellite ecosystem | Planned | Remains directional, not active execution |
| Rust core pivot | Planned | RFC exists; implementation remains on hold pending stronger field signal |

---

## 7. What Counts as Progress Now

Progress should be accepted when it improves one or more of:

1. evidence trust
2. operator trust
3. deployment simplicity
4. field usability
5. OSS adoption quality

Examples of acceptable evidence:

1. real issue reports with reproducible fixes
2. install and upgrade feedback from external users
3. soak notes when a release actually merits them
4. incident reconstruction drills
5. operator-facing documentation improvements

Examples of low-value work from this point:

1. creating additional roadmap decomposition documents
2. treating internal sign-off ceremony as product progress
3. expanding satellite plans without field demand

---

## 8. Completed and Historical Roadmap Documents

These documents are not active execution plans:

1. [ENHANCED-QUARANTINE-PROTOCOL.md](./ENHANCED-QUARANTINE-PROTOCOL.md) - Completed implementation record
2. [RESILIENCE-EDGE-V2.md](./RESILIENCE-EDGE-V2.md) - Archived reference
3. [PILOT-PROGRAM-2026.md](./PILOT-PROGRAM-2026.md) - Archived reference
4. [SPRINT-BOOTSTRAP-GOVERNANCE-PACK.md](./SPRINT-BOOTSTRAP-GOVERNANCE-PACK.md) - Archived reference

Usage rule:

1. Completed records document what shipped; archived references document ideas and historical constraints.
2. Do not treat their phases, sprints, or timelines as active commitments.
3. If a direction becomes active again, restate it here instead of reviving an old sub-roadmap.

---

## 9. Governance Constraints

1. RFC-0000 remains locked and untouched.
2. New architectural work still requires RFC discipline where appropriate.
3. Roadmap simplification does not weaken fail-open, payload-less, or deterministic product constraints.

---

## 10. Out of Scope

1. Pricing tiers and monetization packaging
2. GTM operations and partnerships
3. Internal approval ceremony as a release goal

---

## 11. References

1. [docs/README.md](../README.md)
2. [internal/ROADMAP.md](../../internal/ROADMAP.md)
3. [docs/rfc/0002-Argos.md](../rfc/0002-Argos.md)
4. [docs/rfc/0008-RustCorePivot.md](../rfc/0008-RustCorePivot.md)
5. [docs/rfc/0009-CoordinationProviderContract.md](../rfc/0009-CoordinationProviderContract.md)
6. [docs/rfc/0014-Watchtower.md](../rfc/0014-Watchtower.md)
