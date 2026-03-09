# Critical Security Remediation Plan

> **Status:** Active
> **Created:** 2026-03-09
> **Scope:** Verified remediation plan for critical and high-priority security, memory, performance, and documentation-truth gaps
> **Execution Model:** This branch adds planning only. Remediation implementation starts in follow-up branches after this document is merged.

---

## 1. Purpose

This document converts the March 9, 2026 repository security review into an execution plan that can be tracked, reviewed, and closed with evidence.

The immediate goal is not feature expansion.
The immediate goal is to remove conditions where Tracehound:

1. violates its own fail-open contract
2. permits unbounded resource growth in auxiliary paths
3. overstates isolation or performance guarantees relative to the code
4. carries avoidable supply-chain or control-plane risk

This plan is authoritative for remediation sequencing until all items below are closed or explicitly risk-accepted.

---

## 2. Verified Problem Set

The following findings were verified against the current codebase and test matrix:

1. **Fail-open contract violation in default adapters**
   - Express and Fastify default handlers convert `InterceptResult.status === 'error'` into terminal HTTP `500` responses instead of pass-through behavior.
   - Impact: Tracehound internal failure can become application-visible denial of service.

2. **Unbounded notification resource growth**
   - `NotificationEmitter.subscribe()` uses an unbounded in-memory queue per subscriber.
   - Webhook delivery launches unconstrained async work per event with no global concurrency or backlog cap.
   - Impact: memory growth, event-loop pressure, and control-plane amplification under event storms.

3. **Webhook SSRF hardening gap**
   - Webhook validation relies on a hostname denylist and does not harden redirect behavior or resolve DNS-to-private-address edge cases.
   - Impact: server-side request forgery risk and internal metadata probing exposure.

4. **Non-constant-time equality in a security-sensitive path**
   - `Evidence` constructor hash verification currently uses direct string equality.
   - Impact: standards violation against the repository's own cryptographic comparison rule, even if exploitability is lower than remote timing surfaces.

5. **Published documentation exceeds implemented guarantees**
   - Current docs overclaim fail-open defaults, process isolation, oversized request behavior, and performance complexity/latency guarantees.
   - Impact: audit credibility loss, operator misconfiguration, and unsafe trust assumptions during incidents.

6. **Pinned toolchain version requires security review**
   - Root workspace pins `pnpm@9.1.4`, which must be treated as suspect relative to recently disclosed 2026 pnpm CVEs.
   - Impact: CI/developer environment risk and release hygiene gap.

7. **Performance hot spots conflict with stated SLA language**
   - Quarantine eviction is full-store sort based.
   - Quarantine stats are recomputed by iteration.
   - Rate limiter prunes timestamp arrays by filtering on hot checks.
   - Impact: tail-latency drift versus published p99 targets and inaccurate complexity claims.

---

## 3. Operating Rules For Remediation

All remediation work derived from this plan must satisfy these rules:

1. No remediation may weaken deterministic behavior, fail-open host survivability, or the one-way membrane.
2. Auxiliary control-plane features must become bounded before adding new observer/integration functionality.
3. Documentation claims must not exceed what is verified in code and tests.
4. Every code fix must ship with regression tests that fail without the change.
5. Branches spawned from this plan must stay narrowly scoped so each security closure is reviewable on its own merits.

---

## 4. Execution Sequence

### Phase 0: Freeze and Truth Alignment

Objective: stop further drift while remediation branches are prepared.

Tasks:

1. Treat this document as the active remediation source of truth.
2. Do not expand webhook, notification, or adapter behavior until the boundedness/fail-open fixes land.
3. Do not publish external security/performance claims from documents currently flagged below without correction.

Exit criteria:

1. This plan is merged to the mainline branch.
2. Follow-up branches are cut from the merge commit.

### Phase 1: Restore Fail-Open Adapter Semantics

Objective: make default adapter behavior match the normative fail-open contract.

Scope:

1. `packages/express/src/index.ts`
2. `packages/fastify/src/index.ts`
3. related adapter tests
4. docs that currently imply conflicting behavior

Required changes:

1. Default `error` handling must pass through by default, not emit terminal `500`.
2. Preserve framework error pipeline behavior only for custom handlers that already started a response.
3. Keep `rate_limited`, `payload_too_large`, and `quarantined` status mappings unchanged.

Acceptance criteria:

1. Regression tests prove default adapter behavior is pass-through on `status: 'error'`.
2. Custom `onIntercept` behavior remains supported.
3. `FAIL-OPEN-SPEC.md`, adapter READMEs, and API docs align exactly with implemented behavior.

Recommended branch:

1. `security/fail-open-default-adapters`

### Phase 2: Bound Notification and Subscriber Resource Usage

Objective: remove unbounded memory and async amplification in the notification plane.

Scope:

1. `packages/core/src/core/notification-emitter.ts`
2. notification tests
3. snapshot/watch-facing docs if behavior changes are externally visible

Required changes:

1. Add a bounded queue per async subscriber with deterministic overflow behavior.
2. Add explicit upper bounds for inflight webhook deliveries and/or queued webhook jobs.
3. Ensure retries cannot create unbounded retained promises/timers during event storms.
4. Expose bounded-drop counters or telemetry where useful for operators.

Acceptance criteria:

1. Subscriber memory is bounded by configuration or fixed cap.
2. Webhook dispatch concurrency and backlog are bounded.
3. Stress/regression tests cover slow subscribers, failing webhooks, and burst emission.

Recommended branch:

1. `security/bounded-notification-plane`

### Phase 3: Harden Webhook SSRF Controls

Objective: upgrade webhook delivery from denylist validation to a defensible outbound policy.

Scope:

1. `packages/core/src/core/notification-emitter.ts`
2. tests for URL validation and dispatch policy
3. docs covering webhook behavior

Required changes:

1. Disable redirect following unless there is an explicit reviewed reason not to.
2. Add request timeout and bounded response handling.
3. Strengthen destination validation to account for DNS/private-address resolution strategy or clearly reject unsupported hostname classes.
4. Keep metadata-service and loopback protections.

Acceptance criteria:

1. Tests cover loopback, RFC1918, link-local, metadata endpoints, redirect attempts, and malformed URLs.
2. Webhook delivery behavior is explicitly documented as bounded and SSRF-hardened.
3. The implementation can be defended against OWASP SSRF guidance and CWE-918 review.

Recommended branch:

1. `security/webhook-ssrf-hardening`

### Phase 4: Cryptographic Comparison Compliance Sweep

Objective: eliminate remaining direct equality in security-sensitive hash/signature checks.

Scope:

1. `packages/core/src/core/evidence.ts`
2. targeted grep sweep across core
3. compare tests and any affected unit tests

Required changes:

1. Replace direct hash equality in `Evidence` verification with constant-time comparison.
2. Audit for any additional hash/signature comparisons that violate repository policy.
3. Preserve current error semantics and determinism.

Acceptance criteria:

1. No security-sensitive hash/signature comparisons remain on plain `===`.
2. Tests prove mismatch handling remains correct.

Recommended branch:

1. `security/constant-time-compare-sweep`

### Phase 5: Documentation Truth Correction

Objective: remove overclaims and align operator/security docs to verified runtime behavior.

Scope:

1. `docs/FAIL-OPEN-SPEC.md`
2. `docs/PERFORMANCE-SLA.md`
3. `docs/SECURITY-ASSURANCE.md`
4. `docs/THREAT-MODEL.md`
5. `docs/API.md`
6. adapter READMEs
7. any other surfaced claims discovered during implementation

Required changes:

1. Remove or correct claims of default fail-open behavior where code does not currently enforce it.
2. Remove or qualify claims of OS-enforced child isolation where the implementation is declarative/best-effort.
3. Remove unsupported references to `FilterConfig`, `tracehound.routes.yml`, stream-draining behavior, or other non-existent mechanisms.
4. Replace unverified SLA/complexity claims with measured and test-backed statements only.

Acceptance criteria:

1. No document claims behavior that is absent from code/tests.
2. FAQ, API, SLA, and assurance docs tell the same story.
3. Security review can trace each normative statement to code or automated evidence.

Recommended branch:

1. `docs/security-truth-alignment`

### Phase 6: Performance and Boundedness Refactor

Objective: bring hot-path data structures and observability costs closer to the stated design intent.

Scope:

1. quarantine eviction/data accounting
2. rate limiter pruning behavior
3. performance scenarios and SLA docs

Required changes:

1. Replace full-sort eviction with a bounded structure or deterministic selection strategy that matches documented complexity.
2. Avoid full-store recomputation for commonly emitted quarantine statistics where feasible.
3. Reduce rate-limiter hot-path array churn or cap per-entry history more aggressively.
4. Update performance scenarios to assert values that correspond to published guarantees.

Acceptance criteria:

1. Design rationale is documented or tied to RFC-0011 if core behavior materially changes.
2. Benchmarks and scenario tests justify any published latency/complexity claim.
3. No new unbounded collections are introduced.

Recommended branch:

1. `perf/bounded-hot-paths`

### Phase 7: Supply-Chain Hygiene

Objective: close the toolchain risk gap and make dependency posture auditable.

Scope:

1. root workspace package manager pin
2. lockfile and build instructions
3. release validation notes

Required changes:

1. Review current pnpm CVE exposure against the pinned version.
2. Upgrade to a non-affected pnpm release if needed.
3. Capture the rationale in release/security notes.

Acceptance criteria:

1. Workspace toolchain is pinned to a reviewed version.
2. CI/release notes reflect the upgrade and risk closure.

Recommended branch:

1. `chore/toolchain-security-refresh`

---

## 5. Branch Plan

The intended follow-up branch order is:

1. `security/fail-open-default-adapters`
2. `security/bounded-notification-plane`
3. `security/webhook-ssrf-hardening`
4. `security/constant-time-compare-sweep`
5. `docs/security-truth-alignment`
6. `perf/bounded-hot-paths`
7. `chore/toolchain-security-refresh`

Sequencing rule:

1. Branches 1 through 4 are security blockers.
2. Branch 5 is a merge blocker before any external assurance update or release.
3. Branch 6 may run in parallel after branches 1 through 4 are scoped, but its docs must not land before truth correction.
4. Branch 7 may land early if isolated cleanly from product behavior changes.

---

## 6. Required Test and Validation Gates

Every remediation branch must run the minimum relevant gates:

1. `pnpm --filter @tracehound/core test`
2. `pnpm --filter @tracehound/express test` when Express adapter behavior changes
3. `pnpm --filter @tracehound/fastify test` when Fastify adapter behavior changes
4. `pnpm --filter @tracehound/cli test` when snapshot/inspection or operator-facing docs are affected
5. `pnpm lint`

Additional required coverage by track:

1. Adapter fail-open fixes must add regression tests for pass-through on internal error.
2. Notification/webhook fixes must include burst, slow-consumer, and retry-boundary tests.
3. Performance work must include scenario updates or new benchmarks that justify the final doc language.
4. Docs truth work must include a line-by-line claim audit for the corrected files.

---

## 7. Exit Definition

This remediation program is complete only when all of the following are true:

1. Default adapters honor fail-open behavior on internal Tracehound errors.
2. Notification subscribers and webhook delivery paths are explicitly bounded.
3. Webhook delivery is hardened to a defensible SSRF posture.
4. Security-sensitive equality checks comply with constant-time comparison policy.
5. Public docs no longer overstate isolation, fail-open defaults, stream handling, or latency complexity.
6. Published performance statements are backed by current tests/benchmarks.
7. Workspace toolchain pin is reviewed and updated if vulnerable.

If any item remains open, the corresponding risk must be documented explicitly rather than implied away by assurance language.

---

## 8. Notes For The Merge Commit

This document is intentionally planning-only.

Expected merge message character:

1. `docs: add critical security remediation plan`

Expected follow-up behavior after merge:

1. cut the first remediation branch from the merge commit
2. keep each branch single-purpose
3. do not batch the entire plan into one oversized patchset
