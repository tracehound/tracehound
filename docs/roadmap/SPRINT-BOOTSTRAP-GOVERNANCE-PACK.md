# Sprint Bootstrap Governance Pack (M3 Preparation)

> **Status:** Completed (Archived Reference)
> **Date:** 2026-03-03
> **Horizon:** 2 weeks
> **Execution Mode:** Governance-first
> **Authoritative Roadmap:** [TRACEHOUND-UNIFIED-ROADMAP.md](./TRACEHOUND-UNIFIED-ROADMAP.md)
> **Completed On:** 2026-03-04
> **Use:** Historical governance evidence only. Not an active execution plan.

## 1. Charter

This sprint delivers a decision-complete governance package for the next implementation sprint.
It does not ship runtime behavior changes. It locks RFC direction, quality gates, risk records, and implementation sequencing.

Primary objective:

1. Remove implementation ambiguity for M3 execution (external coordination contract, membrane hardening, pressure containment).
2. Outcome: All post-sprint implementation backlog items (`TH-M3-0009-01` through `TH-M3-0000-DOC`) were completed; this document is retained as governance evidence.

## 2. Baseline Health Snapshot (Pre-Change Gate)

Validated on 2026-03-03:

1. `pnpm test` -> PASS
2. `pnpm lint` -> PASS
3. `pnpm test:coverage` -> PASS
4. Coverage snapshot:
5. Lines: `91.33`
6. Functions: `96.29`
7. Statements: `91.33`
8. Branches: `91.48`

Threshold policy remains unchanged:

1. Lines: `90`
2. Functions: `90`
3. Statements: `90`
4. Branches: `85`

## 3. Scope Lock

In scope:

1. M3 implementation preparation artifacts.
2. RFC backlog creation and numbering (`0009`-`0011`).
3. Risk register and decision tables.
4. Gate checklist attachment to sprint closure.

Out of scope:

1. Core or adapter runtime behavior changes.
2. M4 external audit execution.
3. GTM/pricing content.

## 4. Single Source Rule (Locked)

1. [TRACEHOUND-UNIFIED-ROADMAP.md](./TRACEHOUND-UNIFIED-ROADMAP.md) is the single technical roadmap source.
2. Source modules remain risk/analysis inputs only:
3. [ENHANCED-QUARANTINE-PROTOCOL.md](./ENHANCED-QUARANTINE-PROTOCOL.md)
4. [RESILIENCE-EDGE-V2.md](./RESILIENCE-EDGE-V2.md)
5. [PILOT-PROGRAM-2026.md](./PILOT-PROGRAM-2026.md)
6. No cross-module sequencing authority may move out of the unified roadmap.

## 5. Two-Week Plan

### Week 1 - Decision Freeze

1. Publish roadmap execution charter (this file).
2. Publish RFC drafts:
3. `RFC-0009` Coordination provider contract + fail-open degradation.
4. `RFC-0010` One-way membrane + runtime payload blindness + trace id signaling.
5. `RFC-0011` Pressure containment: Drop and Count, memory-first buffering, graceful 413 shield.
6. Publish risk register with mandatory one-line fields per RFC:
7. Weakest assumption
8. First failure point
9. Blast radius

### Week 2 - Implementation Readiness

1. Publish decision tables per RFC:
2. Invariant impact (`fail-open`, `determinism`, `payload-less`, `bounded memory`)
3. Adapter impact (Express/Fastify mapping and fail-open behavior)
4. Freeze mandatory test classes per RFC:
5. Unit
6. Integration
7. Scenario
8. Security-negative
9. Publish post-sprint implementation backlog with:
10. File scope
11. Acceptance criteria
12. Mandatory tests
13. Rollback note
14. Enforce closure gate: sprint does not close without all governance artifacts complete.

## 6. RFC Backlog and Ordering

| Order | RFC | Title | Status | Milestone Binding |
| --- | --- | --- | --- | --- |
| 1 | [0009-CoordinationProviderContract.md](../rfc/0009-CoordinationProviderContract.md) | External Coordination Provider Contract | Draft | M3 |
| 2 | [0010-OneWayMembrane.md](../rfc/0010-OneWayMembrane.md) | One-Way Membrane and Trace ID Signaling | Draft | M3 |
| 3 | [0011-PressureContainment.md](../rfc/0011-PressureContainment.md) | Pressure Containment and Graceful Shielding | Draft | M3 |

## 7. Risk Register (Mandatory Fields)

| RFC | Weakest assumption | First failure point | Blast radius |
| --- | --- | --- | --- |
| RFC-0009 | External provider lag stays bounded enough to avoid stale enforcement pressure. | Health mode transitions oscillate under intermittent network loss. | Coordination behavior only; core local mode remains available if fail-open is preserved. |
| RFC-0010 | Trace id can aid debugging without exposing payload intelligence to adversaries. | Adapter response metadata leaks become user-observable in strict privacy environments. | Adapter response surface and developer tooling; no raw payload release allowed. |
| RFC-0011 | Drop and Count thresholds are tuned to protect host survivability without excessive evidence loss. | Sustained burst exceeds memory budget before shedding trigger calibrates. | Quarantine completeness and observability fidelity; host application survivability remains priority. |

## 8. RFC Decision Tables

### RFC-0009 Decision Table

| Decision Point | Outcome |
| --- | --- |
| Fail-open invariant | Coordination outages force `local`/`degraded` modes; host traffic flow continues. |
| Determinism invariant | Coordination calls are out-of-band and never alter deterministic signature path. |
| Payload-less invariant | Coordination sync surfaces signatures and metadata only; no payload egress. |
| Bounded memory invariant | Provider queues are bounded; overflow drops coordination sync jobs deterministically. |
| Adapter impact | No status map changes. Express/Fastify continue normative mapping. |

### RFC-0010 Decision Table

| Decision Point | Outcome |
| --- | --- |
| Fail-open invariant | Membrane failures return safe intercept outcomes; adapter fallthrough remains available. |
| Determinism invariant | Trace id generation must be deterministic per evidence lifecycle policy or explicitly non-security identity scoped. |
| Payload-less invariant | Runtime APIs remain metadata-only; raw bytes stay inside Quarantine boundary. |
| Bounded memory invariant | Trace id index in runtime paths must be bounded with explicit TTL/size controls. |
| Adapter impact | `x-tracehound-trace-id` is design-only in this sprint; status code mapping is unchanged. |

### RFC-0011 Decision Table

| Decision Point | Outcome |
| --- | --- |
| Fail-open invariant | Pressure escalation cannot crash host; overloaded paths degrade to shedding and bounded logging. |
| Determinism invariant | Shedding thresholds and decay ordering are deterministic per configuration. |
| Payload-less invariant | Shedding counters and pressure metrics never include raw payload. |
| Bounded memory invariant | Ring-buffer memory cap is hard; when exceeded, system drops and counts. |
| Adapter impact | Graceful `413` shielding proposed; normative adapter status mapping remains unchanged. |

## 9. Test and Acceptance Map

| RFC | Unit | Integration | Scenario | Security-negative | Acceptance signal |
| --- | --- | --- | --- | --- | --- |
| RFC-0009 | Provider state transitions, queue bounds, health snapshots | Core + optional provider wiring | Provider unavailable/degraded recovery | Replay/stale-state injection attempts | Local mode fallback proven and no host interruption |
| RFC-0010 | Membrane access guards, trace id lifecycle | Adapter metadata response paths | Quarantined high-throughput + inspect workflow | Runtime payload extraction attempts | No payload escape and migration guidance is complete |
| RFC-0011 | Threshold enforcement, drop counter increments, ring bounds | Core + adapter overload behavior | Burst + slow sink + jitter + TTL storm | Resource exhaustion and malformed stream tests | Host survives overload and bounded memory remains intact |

## 10. Post-Sprint Implementation Backlog (Decision-Complete)

| Work ID | File scope | Acceptance criteria | Mandatory tests | Rollback note |
| --- | --- | --- | --- | --- |
| TH-M3-0009-01 | `packages/core/src/types/*`, `packages/core/src/core/*` | Coordination contracts compile as public types without hot-path coupling. | Unit + RFC compliance update | Revert single commit introducing coordination types and exports. |
| TH-M3-0009-02 | `packages/core/src/core/agent.ts`, `packages/core/tests/*` | Agent preserves local behavior when provider is absent or degraded. | Integration + scenario (`fail-open` path) | Revert provider integration commit; local-only mode remains. |
| TH-M3-0010-01 | `packages/core/src/core/*`, `packages/core/src/types/*` | Runtime API remains metadata-only and rejects direct payload egress paths. | Unit + security-negative | Revert membrane enforcement commit; restore previous metadata contract only if regression found. |
| TH-M3-0010-02 | `packages/express/src/index.ts`, `packages/fastify/src/index.ts`, tests | Optional trace id response metadata emitted without status-map drift. | Adapter smoke + integration | Revert adapter metadata commit; retain existing response behavior. |
| TH-M3-0010-03 | `packages/cli/src/commands/inspect.ts`, CLI tests | CLI inspect path resolves trace id to local evidence metadata without raw leakage defaults. | Unit + smoke | Revert CLI trace-id workflow commit. |
| TH-M3-0011-01 | `packages/core/src/core/quarantine.ts`, `packages/core/src/core/scheduler.ts`, tests | Hard memory cap enforcement triggers deterministic Drop and Count. | Unit + scenario stress | Revert pressure control commit and restore previous bound policy. |
| TH-M3-0011-02 | `packages/core/src/core/cold-storage.ts`, tests | Memory-first buffer default; disk buffering remains explicit opt-in. | Integration + scenario | Revert buffering default commit. |
| TH-M3-0011-03 | `packages/express/src/index.ts`, `packages/fastify/src/index.ts`, tests | Oversized Scent handling maps to graceful `413` without socket destruction semantics. | Adapter smoke + security-negative | Revert graceful shield commit and restore prior adapter handling. |
| TH-M3-0011-04 | `packages/core/scenarios/*`, `packages/core/tests/*` | Pressure, degraded coordination, and membrane tests are represented in scenario suite. | Scenario + regression set | Revert scenario expansion commit if flakiness or false positives emerge. |
| TH-M3-0000-DOC | `docs/API.md`, `docs/CONFIGURATION.md`, `packages/core/CHANGELOG.md` | Docs/changelog updated in same sprint as behavior changes. | Docs QA checklist | Revert doc-only commit if linked behavior changes are deferred. |

## 11. Closure Gate Checklist (Attached)

Sprint closure completed on 2026-03-04. Checklist is retained for audit traceability.

- [x] RFC drafts `0009`-`0011` exist and follow governance structure.
- [x] Risk register complete with required one-line fields per RFC.
- [x] Decision tables complete with invariant and adapter impact.
- [x] Test mapping complete for unit/integration/scenario/security-negative classes.
- [x] Implementation backlog includes file scope, acceptance criteria, mandatory tests, rollback notes.
- [x] Single source rule restated and aligned with unified roadmap.
- [x] Pre-change gate baseline executed (`pnpm test`).

## 12. Assumptions and Defaults

1. Timeline is fixed to 2 weeks for this bootstrap sprint.
2. Strategy is governance-first.
3. All outputs in this sprint are documentation and RFC artifacts only.
4. Horizon remains external to this monorepo.
5. Coverage thresholds remain fixed (`90/90/90/85`) and must not be lowered.
