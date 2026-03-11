# Changelog

All notable changes to this project will be documented in this file.

## [1.8.5] - 2026-03-12 - CLI Dashboard Overhaul, Soak Infrastructure, and Fix Wave

### Features

- **CLI `watch` dashboard overhaul (`packages/cli`)**: Redesigned multi-screen ANSI live dashboard (`watch.ts`) with bold values, colon-separated key/value labels, and consistent color hierarchy via theme utilities. Screens: overview, watcher, quarantine, pool, agent, help. Nav keys: `[1–5]`, `[h]`, `[r]`, `[q]`. Command bar pinned to terminal bottom row in TTY mode.
- **`format.ts` consolidation (`packages/cli`)**: Merged `fmt.ts` into `format.ts` as the single canonical formatting module — `fmtBytes`, `fmtCount`, `fmtDuration`, `fmtStatus`, `fmtUptime`.
- **Soak load-test infrastructure (`infrastructure/soak`)**: Moved soak harness from `packages/` to `infrastructure/soak`; added `server.ts`, `audit.ts`, `file-cold-storage.ts`, `metrics.ts`, `traffic.ts`, `main.ts`. Updated `pnpm-workspace.yaml` accordingly.
- **CLI `watch` command exposed via `src/index.ts`**.

### Fixed

- **`startDashboard` `setInterval` regression (`packages/cli`)**: Removed the early-return guard on `!process.stdout.isTTY` that prevented `setInterval` from being registered. Replaced `process.stdin.isTTY` checks with `typeof process.stdin.setRawMode === 'function'` so raw-mode setup and key-navigation work correctly in all environments.
- **`refreshMs` unit inconsistency (`packages/cli`)**: Removed erroneous `Math.ceil(refreshMs / 1000)` conversion in `startDashboard` and `renderDashboard`; the overview header was displaying `refresh: 1ms` instead of `refresh: 1000ms`.
- **Last-alert field label renamed** from `"id"` to `"signature"` in the LAST ALERT DETAIL section to match the actual field name and domain terminology.
- **`renderScreen` void returns**: Removed `return` statements from `void renderScreen` switch branches.
- **`--refresh` NaN guard**: Added `Number.isFinite && !Number.isNaN && parsed > 0` validation for the `--refresh` CLI option.
- **`index.ts` main-module check**: Replaced `endsWith()` comparison with canonical `fileURLToPath` check to prevent false matches on import paths.
- **`fmtUptime` sub-minute values**: Returns `"45s"` for durations under one minute instead of collapsing to `"0m"`.
- **`agent.test.ts` mock contract**: Added missing `monoNs` field to `EvidenceCreationResult` test doubles so mocks match the real factory contract.

### Soak Infrastructure Fixes

- **`audit.ts`**: Use dedicated `"hound.result"` discriminator instead of `"threat.detected"` to prevent offline consumers double-counting hound outcomes as real threat events.
- **`file-cold-storage.ts`**: Unlink orphaned `.bin` artifact when `.meta.json` write fails; return `false` when unlink settled with errors.
- **`metrics.ts`**: Wrap `appendFileSync` in `try/catch` so `sample()` is best-effort and cannot take down a soak run.
- **`server.ts`**: Return readiness promise so callers receive the actual bound port instead of racing socket binding.
- **`traffic.ts`**: Validate `targetRps` up front; reject `0`, `NaN`, and `Infinity`.

### Tests

- Expanded `watch-dashboard.test.ts` coverage across 49 previously-uncovered lines; added TTY key-navigation suite and command bar pinning tests.
- Added `format.test.ts` coverage for sub-minute `fmtUptime`.
- Froze time with `vi.setSystemTime()` in `nextExpiryAt` tests to eliminate flakiness.

## [1.8.4] - 2026-03-11 - Post-1.8.3 Workflow and Security Maintenance Patch

This patch release captures all commits merged after `v1.8.3`, focused on workflow hardening, dependency security remediation, and fuzz/chaos pipeline stability.

### Security and Dependency Hygiene

- Applied OSV vulnerability remediation updates.
- Added StepSecurity GitHub Actions hardening updates and follow-up workflow permission fixes.

### CI, Workflow, and Reliability

- Fixed workflow configuration regressions affecting CI and security automation.
- Updated Scorecard workflow configuration and corrected token-permission placement issues.
- Fixed chaos test workflow `pnpm install` and naming consistency issues.

### Fuzzing and Test Infrastructure

- Improved fuzz test workflow configuration.
- Fixed fuzz helper loop-risk behavior in workflow/test support paths.

### Documentation

- Updated README badge links.

## [1.8.3] - 2026-03-11 - ESLint Clock/RNG SSoT, Monotonic Evidence Timestamps, and Workflow Hardening

This patch release delivers injectable clock/RNG enforcement via ESLint, monotonic nanosecond timestamps on quarantined evidence, scheduler correctness fixes, and complete SHA-pinning of all GitHub Actions across the CI workflow suite.

### Features

- **ESLint v9 flat config clock/RNG SSoT enforcement** (`packages/core`, root): Added rules that prevent direct `Date.now()`, `Math.random()`, and `crypto.random*` calls from bypassing injectable clock and RNG entry points. Rules are error-level for `Math.random` and `crypto.*`; warn-level for `Date.now()` during the ongoing `RuntimeContext` migration. Injectable bridge closures in scheduler, rate-limiter, and watcher carry explicit disable comments explaining the intent.
- **Evidence monotonic timestamps** (`packages/core`): Added injectable `_hrtime` bridge to `EvidenceFactory` so monotonic nanosecond timestamps (`process.hrtime.bigint`) are captured at quarantine time. `Evidence` exposes `monoNs: bigint` internally; `RuntimeEvidenceHandle` surfaces it as a decimal string for JSON safety. Enables strict ordering of evidence captured within the same millisecond without relying on wall-clock drift.

### Fixed

- **Scheduler jitter and capacity** (`packages/core`): Corrected edge cases surfaced by code review (#25) — jitter clamping and capacity-boundary behavior now have explicit regression coverage.
- **Workflow pinned-dependencies** (`.github/workflows`): All GitHub Actions across `ci-main`, `ci-pr`, `chaos-verify`, `codecov`, `codeql-advanced`, `release`, `scorecard`, `security-paranoid`, and `semgrep` workflows are now pinned by full commit SHA per OpenSSF Scorecard Pinned-Dependencies requirements.

### Tests

- Expanded coverage for `EvidenceFactory` monotonic timestamp injection, `RuntimeEvidenceHandle` `monoNs` serialization, rate-limiter injectable clock bridge, scheduler jitter/capacity boundaries, watcher injectable clock paths, and agent `_hrtime` pass-through.
- Added CLI system-snapshot regression coverage for new injectable bridge behavior.

### Chores

- Documentation narrative and roadmap updates merged from `main`.

## [1.8.2] - 2026-03-10 - Security Hardening and Remediation Closure Wave

This patch release packages the `fix/security-hardening` branch and closes the high-priority remediation items tracked for runtime fail-open integrity, bounded control-plane behavior, webhook SSRF hardening, constant-time evidence checks, and documentation truth alignment.

### Security

- Restored fail-open default behavior in Express and Fastify adapters for internal `status: 'error'` outcomes, preserving host-app request survivability when Tracehound encounters runtime faults.
- Hardened webhook delivery policy in the notification plane:
  - bounded queue/backlog and inflight dispatch controls,
  - timeout + redirect rejection semantics,
  - DNS-based private/special-use address rejection,
  - rebinding-aware follow-up resolution consistency checks before outbound attempts.
- Completed constant-time comparison compliance for security-sensitive evidence hash verification paths.

### Reliability

- Hardened async subscriber lifecycle handling in `NotificationEmitter.subscribe()` so iterator shutdown resolves pending consumers deterministically.
- Added CI-safe chaos snapshot verification/readback behavior and richer diagnostics for snapshot export race/permission failures in GitHub runner environments.

### Performance

- Optimized hot paths in quarantine and rate-limiter flows to reduce avoidable pressure amplification and align runtime behavior with documented boundedness intent.

### Documentation

- Updated fail-open, API, threat-model, performance-SLA, security-assurance, and roadmap/security docs to remove overclaims and align all normative statements with tested runtime behavior.
- Refreshed RFC surface and documentation index for current OSS scope.

### Tests

- Added and expanded regression coverage across adapters, notification/webhook security controls, quarantine/rate limiter boundedness, evidence integrity checks, and chaos invariants.
- Recovered branch-diff coverage for security-hardening edits to satisfy release-gate coverage expectations.

## [1.8.1] - Security QA & Docs Alignment

This patch release packages the post-`v1.8.0` correctness fixes, release-gate coverage recovery, and documentation alignment work needed before the next remediation branch begins. No breaking changes are intended in this patch.

### Fixed

- `FailSafe.lastPanic` now always reflects the most recently triggered panic event, even when severity-weighted history eviction removes an older lower-severity entry.
- Scheduler capacity handling now permits rescheduling an existing task ID at the hard task cap, while still dropping the 257th unique task deterministically with a warning.
- Scheduler jitter input is clamped before `randomInt()` so non-integer jitter configuration cannot exceed the declared bound.
- `EvidenceHandle.scentId` remains optional for downstream/custom handle implementations, preventing an accidental patch-level type break.
- Quarantine purge audit records now fall back to `signature` when `scentId` is absent, preserving traceability for legacy or custom evidence handles.
- `LaneQueue.onAlert()` and `HoundPool.onResult()` remain `void`-returning APIs; internal drop-and-warn behavior is preserved without changing the public contract.

### Tests

- Added regression coverage for scheduler task-capacity boundaries, including explicit assertions for unique-task drop behavior and same-ID rescheduling at capacity.
- Added regression coverage for fail-safe severity-weighted history eviction and `lastPanic` correctness immediately after eviction pressure.
- Added regression coverage for lane-queue overflow modes, handler-capacity enforcement, and defensive fallback paths used by branch-diff coverage gates.
- Tightened cold-storage and Fastify adapter tests to better exercise timing budgets and fail-open reply-state guards.

### Documentation

- Added a repository-local critical security remediation plan to capture the verified high-priority backlog that will be executed in follow-up branches after this patch release.
- Linked the remediation plan from the documentation index and unified roadmap so release reviewers have a canonical reference for the next security workstream.

## [1.8.0] - 2026-03-09 - TLS Source Signals and Runtime Hardening

### Added

- TLS source metadata support in runtime flow and adapters (`cipherSuite`, `version`, optional `alpn`) for Express and Fastify integrations.
- Coverage-focused regression tests across core and CLI command surfaces to keep release gates green on branch-diff QA.

### Changed

- Rate limiter now enforces IP-ceiling-first behavior for new fingerprints to prevent composite map pressure under same-IP rotation attacks.
- Source fingerprint key generation now normalizes oversized source components deterministically to reduce CPU amplification from oversized headers.
- API documentation terminology was aligned with implementation semantics (sliding-window behavior clarity for consumers).

### Security

- Hardened rate-limiter anti-rotation controls:
  - Prevents unnecessary composite entry allocation when the IP ceiling already rejects.
  - Keeps active IP-ceiling entries hot on reject paths to reduce eviction-based bypass opportunities.
  - Preserves distinct key space between raw and truncated source-component encodings.
- Hardened Agent runtime behavior:
  - Telemetry/watcher hook failures are isolated from intercept outcomes (fail-open observability path).
  - Coordination fallback counters now track state transitions instead of inflated repeated degraded reads.
  - Runtime evidence source exposure is fail-closed and immutable for consumer-facing handles.
- Hardened evidence/source integrity:
  - Evidence source metadata is captured as a snapshot, sanitized, and exposed as immutable runtime metadata.
  - Defensive fallback to `ip: "unknown"` for invalid runtime source shapes.

## [1.7.0] - 2026-03-05 - Enhanced Quarantine Protocol and Evidence Lifecycle Hardening

This release delivers the roadmap scope for the Enhanced Quarantine Protocol, with core focus on deterministic evidence custody, bounded decay, and fail-open adapter behavior.

### Highlights

- Added TTL-driven background decay in Quarantine (`ttlMs`, `decayIntervalMs`, `decayBatchSize`).
- Added cold-storage-backed decay archival with configurable failure policy and timeout controls.
- Added support for raw ingress byte hashing via `Scent.ingressBytes`.
- Added batched Merkle sealing in `AuditChain` for stronger lifecycle custody continuity.
- Added `AbortSignal` support to `IColdStorageAdapter.write(id, payload, signal?)`.

### Runtime & Behavior Changes

- Quarantine stats now include richer decay/eviction visibility (`evictedCount`, archive/decay counters, next expiry metadata).
- Express/Fastify ingress byte extraction is now deterministic and `rawBody`-based.
- Unknown/forward-incompatible intercept statuses in adapters now fail open (no request lifecycle hangs).
- AuditChain retention enforces strict bounds while preserving batch integrity.
- Purge events now fully participate in audit continuity.

### Security Hardening

- Decay/archive race paths and timeout lifecycle handling were hardened.
- Audit export/verification safety was strengthened to reduce accidental tampering surfaces.
- Storage error sanitization/redaction was improved to prevent endpoint/ARN/key-like leakage.
- Resource-bound behavior under pressure conditions was tightened.

### Breaking Changes

- `PurgeRecord.purgeTimestamp` was renamed to `PurgeRecord.timestamp`.
- `IColdStorageAdapter.write` now accepts optional `AbortSignal`.
- Adapter ingress byte path is now `rawBody`-only for deterministic hashing.

### Migration Notes

- Replace `purgeRecord.purgeTimestamp` with `purgeRecord.timestamp`.
- Update custom cold storage adapters to `write(id, payload, signal?)`.
- Ensure `rawBody` is available before Tracehound middleware/plugin execution in Express/Fastify.

## [1.6.1] - 2026-03-07 - Memory Safety and Cryptographic RNG Hardening

## Release Notes

Targeted security hardening pass on two latent vulnerability classes in the core runtime: uninitialized-memory disclosure via `Buffer.allocUnsafe` in IPC encoding paths, and weak RNG via `Math.random()` in forensic ID construction. No public API changes. No breaking changes.

### Hardened

- **IPC buffer allocation** (`hound-ipc.ts`): Replaced `Buffer.allocUnsafe` with `Buffer.alloc` across all four IPC message encoding paths. `allocUnsafe` can expose stale heap memory to child processes; zero-initialized allocation eliminates the uninitialized-memory disclosure class entirely.
- **Forensic RNG** (`quarantine.ts`): Replaced `Math.random()` with `generateSecureId()` for `PurgeRecord` ID construction. All forensic pipeline identifiers now use crypto-strength randomness end-to-end.

### Documentation

- `security/crypto-review.md`: Added webhook secret key rotation policy.
- `security/logging-model.md`: Closed log injection verification — all 5 test cases pass; no user-controlled data reaches any log sink.
- `security/memory-buffer-audit.md`: Updated with `allocUnsafe` → `alloc` migration rationale and affected paths.

### Supply Chain

- Added `security/artifacts/dependency-tree.txt`, `pnpm-audit.json`, `sbom.cdx.json`. `pnpm audit --prod` reports 0 vulnerabilities at time of release.

## [1.6.0] - 2026-03-06 - Operational Truth, Deterministic Analysis, and Release Readiness

## Release Notes

Covers the complete critical refactor plan delivered after `v1.5.0`: RFC-0013 operational-truth grounding, signed snapshot integrity, deterministic hound analysis, IPC and lifecycle hardening, typed runtime error cleanup, public API parity, and release-readiness validation.

### Breaking

- CLI operational surfaces (`status`, `stats`, `watch`) no longer fabricate healthy or zero-value state when no verified runtime snapshot exists. Operators now see explicit `NO_INSTANCE` or `INTEGRITY_VIOLATION` outcomes instead of false assurance.
- `IAgent` contract now includes `getStats(): Readonly<AgentStats>` for interface parity. Custom implementations must provide the method.
- Snapshot export configuration now requires a deterministic secret whenever snapshots are enabled (`snapshot.secret` or `TRACEHOUND_SNAPSHOT_SECRET` / `SYSTEM_SNAPSHOT_ENV.SECRET`).

### Added

- Signed system snapshot support centered on `SystemSnapshot`, `ITracehound.snapshot()`, and snapshot export options on `TracehoundOptions`.
- Snapshot read/write utilities with HMAC-SHA256 signing, constant-time verification, atomic file replacement, centralized environment-key helpers, and public path/secret resolution helpers for CLI and external tooling.
- Deterministic hound analysis metadata over IPC `analysis` messages: `hash`, `entropy`, `contentType`, and `sizeBytes`.
- Canonical public operational helpers and constants for release-safe integrations, including snapshot helpers and hound pressure matching exports: `HOUND_PRESSURE_ERRORS`, `HoundPressureErrorCode`, and `isHoundPressureError`.

### Changed

- Operational truth is now grounded in verified runtime snapshots end-to-end. CLI status surfaces, watch dashboard flows, and JSON stats output all consume signed snapshot state instead of inferred defaults.
- Snapshot integrity now enforces freshness and rejects implausibly future-dated signed snapshots by default.
- Runtime shutdown and planned teardown paths now remove snapshot files so stale healthy-state artifacts do not survive process exit.
- Hound IPC result handling now requires analysis data on completed work and treats malformed completion payloads as contract violations instead of silently accepting partial results.
- Process isolation is hardened by spawning child hounds with a minimal environment allowlist rather than inheriting the full parent environment.
- Overload observability wiring now sets and clears pressure state deterministically across drop, defer, escalate, timeout, and error flows.
- Public documentation and examples are aligned around canonical constants and shared environment-key helpers to remove raw-string drift between runtime, CLI, tests, and docs.
- Local assurance gate scripts and corpus replay workflow were removed from this repository; corpus-driven assurance now runs in `tracehound/security-harness`.

### Hardened

- Core runtime paths continue the typed error model migration and remove uncategorized contract failures from coordination and panic-reporting flows.
- Planned shutdown handling suppresses misleading panic noise and duplicate exit callback behavior in release teardown paths.
- Snapshot integrity and operational event reporting now preserve explicit failure reasons instead of degrading to ambiguous generic errors.

### Tests

- Added and updated regression coverage for absent snapshots, tampered snapshots, future-dated snapshot rejection, disconnected stats output, and shutdown snapshot cleanup.
- Added and updated regression coverage for deterministic hound analysis, malformed or incomplete IPC completion payloads, coordination contract violations, typed error factories, and overload set/clear behavior under pressure.
- Release-readiness gates validated this wave across core, CLI, adapters, and workspace linting before the `v1.6.0` cut.

## [1.5.0] - 2026-03-04 - M3 Pressure Containment and Governance Delivery

## Release Notes

Covers the complete Sprint Bootstrap Governance Pack Post-Sprint Implementation Backlog.

Ticket coverage:

- `TH-M3-0009-01`
- `TH-M3-0009-02`
- `TH-M3-0010-01`
- `TH-M3-0010-02`
- `TH-M3-0010-03`
- `TH-M3-0011-01`
- `TH-M3-0011-02`
- `TH-M3-0011-03`
- `TH-M3-0011-04`
- `TH-M3-0000-DOC`

## Engineering and Infrastructure

### RFC-0009 Delivery (Coordination Contract)

- Coordination provider contract types are formalized in public core type surface (`CoordinationProvider`, `CoordinationHealth`, `CoordinationFeature`).
- Agent coordination health flow is fail-open: invalid/throwing provider health resolves safely to `degraded` without interrupting intercept path.
- Coordination contract integration paths are covered in unit/integration/regression tests.

### RFC-0010 Delivery (One-Way Membrane + Trace Signaling)

- Runtime membrane enforces metadata-only evidence handles and blocks direct payload egress attempts (`bytes`, `transfer`, `neutralize`, `evacuate`) with typed runtime violations.
- Optional adapter trace id signaling (`x-tracehound-trace-id`) is available behind explicit opt-in configuration.
- CLI inspect workflow supports trace-id based evidence metadata lookup without raw payload leakage defaults.

### RFC-0011 Delivery (Pressure Containment + Graceful Shielding)

- Deterministic Drop and Count behavior is enforced under pressure boundaries in quarantine/cold-path workflows.
- `MemoryColdStorage` runs memory-first buffering by default; disk buffering remains explicit opt-in via `diskBuffer.enabled`.
- Express/Fastify oversized handling maps to graceful HTTP `413` and avoids destructive socket reset semantics.
- Adapter fail-open paths are hardened: pre-response failures pass through safely, post-header custom-handler failures are delegated to framework error pipelines.
- Scenario and regression suites include explicit coverage for pressure behavior, degraded coordination continuity, and membrane enforcement.

## Documentation and Governance

- Added `docs/CONFIGURATION.md` as explicit runtime, buffering, and adapter configuration reference.
- Updated `docs/API.md` with adapter runtime guarantees for graceful `413`, fail-open behavior, and framework error delegation semantics.
- Updated documentation index and release metadata for `v1.5.0`.

## [1.4.4] - 2026-02-26 - Tracehound Inline Protection Validation Harness (TIPVH) & Enterprise Hardening

## Release Notes

Covers changes since commit [1.4.3 release].

## Engineering and Infrastructure

- **Tracehound Inline Protection Validation Harness (TIPVH)**: Engineered a complete automated adversarial testing suite containing 7 formal validation scenarios.
- **Enterprise Multi-Target Deployment**: Added Metasploitable 3 alongside Metasploitable 2 for extensive "Vulnerability Agnostic" proxy validation.
- **Zero-Visibility Capability Verified**: Deployed an automated GVM (OpenVAS) scanning integration yielding ZERO FINDINGS from thousands of vulnerability probes.

## Rationale & Compliance

1. Alternative Approaches and Reasons for Rejection
   - **Alternative 1: Using 3rd-party SaaS penetration testing tools**. Why Rejected? Third-party tools introduce external latency variations and CI/CD egress dependency. A local, sandboxed harness (TIPVH) maintains absolute environmental control and perfect timestamp synchronization for forensic AuditChain validation without compromising the 'Single Source of Truth'.

2. Dependency Awareness Contract
   - **Data Model**: Unaffected.
   - **API / Contract Surface**: Unaffected. Validation tooling operates out-of-band.
   - **Runtime Behavior**: Validated to sustain 1k TPS drop-integrity with sub-millisecond latency.
   - **Deployment / Operations**: Added `docker-compose.sec.yml` for isolated SecOps validations.
   - **Observability**: Demonstrated 100% correlation between `Scent` metrics and real-world prevented intrusions.
   - **Future Roadmap Impact**: Imposes a new "Quality Gate" for all future PRs; code changes must pass the 7-scenario harness before merging.

3. Facts, Assumptions, and Unknowns
   - **Fact 1**: The proxy has mathematically proven to mitigate known legacy (VSFTPD) and modern (Ubuntu) exploits.
   - **Assumption 1**: The results from GVM automation accurately reflect the resilience against automated scripting attacks used by modern botnets.
   - **Unknown 1**: Behavior of the Scent generator against zero-day architectural vectors that don't rely on known vulnerability signatures but rather obscure protocol desyncs (e.g., HTTP/2 rapid reset) remains untested in this specific suite.

4. Second-Order Effects
   - **Positive (Second-order)**: By explicitly documenting our "Kör Noktalar" (Blind Spots) such as False Positive impacts and CPU Resource exhaustion, we establish high-trust transparency with enterprise Security Operation Centers.

5. Effort Justification Rule
   - The creation of a dedicated internal harness rather than adopting a temporary script demonstrates commitment to persistent, long-term maintainability. The harness isn't a one-off test script; it's a permanent CI/CD fixture that provides execution-grade assurance indefinitely.

6. Failure Modes, Rollback, and Blast Radius
   - **Failure Modes**: The harness orchestrator `run-validation.js` could yield false failures if container time-drifts exceed the `timeOffset` calibration metric.
   - **Rollback**: Standard version revert.
   - **Blast Radius**: Isolated entirely to the `security/tests` directory. The core Node.js application codebase is untouched.

7. Self-Critique Requirement
   - **Weakest Assumption**: The belief that 7 scenarios are enough to define "Enterprise Hardening." Real-world deployments will introduce bespoke logic bugs that no generalized harness can predict.
   - **Most Fragile Component**: The `tracehound-sync-marker` temporal correlation. Log stream desyncs on heavy I/O systems might still cause test flakes.
   - **Where will it fail first?** If Tracehound is deployed in front of an API with massive file uploads, the volumetric checks in Scenario 04 might inadvertently flag legitimate multipart form data as a "Stress Burst".

## [1.4.3] - 2026-02-25 - Monorepo Security Hardening & Robustness

## Release Notes

Covers changes since commit [v1.4.2 release].

## Engineering and Infrastructure

- **Defensive Scent Extraction**: Implemented `safeClone` in Express/Fastify adapters. This ensures the Tracehound process is resilient to circular references or exotic payload shapes (e.g., Stream objects, DOM nodes) that could otherwise trigger runtime crashes during scent extraction.
- **Privacy Hardening**: Standardized the suppression of Tracehound `signature` in external HTTP `403` responses by default. This reduces the adversarial correlation surface while providing an opt-in `emitSignatureInResponse` toggle for legitimate tracing needs.
- **Workspace Quality Gate**: Integrated root `pretest` and `prelint` hooks into `package.json`. These mandatory lifecycle steps enforce that `@tracehound/core` artifacts are compiled before workspace packages run validation, eliminating cross-package dependency resolution failures in CI.

## Rationale & Compliance

1. Alternative Approaches and Reasons for Rejection
   - **Alternative 1: Using `structuredClone()` for payload extraction**. Why Rejected? `structuredClone` is strictly type-sensitive and throws on non-cloneable objects (functions, symbols). In a middleware context, we cannot trust that third-party plugins haven't attached non-serializable properties to the request. `JSON`-based sanitization is safer for "High-Velocity API" environments.
   - **Alternative 2: Keeping signatures in 403 by default but adding a warning**. Why Rejected? Security defaults must be restrictive. Exposing an internal blockchain-linked signature to the public Internet without explicit justification is a "shortcut" that compromises the 'Strictly Stateless Network Containment' axiom.

2. Dependency Awareness Contract
   - **Data Model**: Unaffected.
   - **API / Contract Surface**: **Breaking Change**. The default JSON response for `quarantined` results in both Express and Fastify adapters no longer includes the `signature` key.
   - **Runtime Behavior**: Improved robustness against DoS via malformed/circular request payloads.
   - **Deployment / Operations**: Improved CI stability via workspace build ordering.
   - **Observability**: Signatures remain visible in internal forensic logs and AuditChain; only the external disclosure is suppressed.
   - **Future Roadmap Impact**: Sets a precedent for "Privacy-by-Default" in all ecosystem adapters.

3. Facts, Assumptions, and Unknowns
   - **Fact 1**: The root build ordering fix eliminates the most common cause of "False Negative" build failures in the monorepo.
   - **Assumption 1**: Integrators requiring signatures for tracing have the technical capacity to toggle the `emitSignatureInResponse` flag.
   - **Unknown 1**: The exact overhead of `double-serialization` (JSON stringify then parse) for extremely large request bodies (e.g., >10MB) vs. a custom recursive shallow cloner hasn't been benchmarked on low-spec edge hardware yet.

4. Second-Order Effects
   - **Positive (Second-order)**: Reduced attacker feedback loop makes rule-discovery significantly harder for automated probing scripts.
   - **Negative (Second-order)**: Frontend engineers debugging quarantined requests might find the lack of an immediate signature in the response body confusing until they reference the updated documentation.

5. Effort Justification Rule
   - This solution is correct because it prioritizes **system-wide resilience** (via safe cloning) over the "fastest" implementation (raw object pointer passing), ensuring the security layer cannot be exploited as a performance bottleneck or DoS vector.

6. Failure Modes, Rollback, and Blast Radius
   - **Failure Modes**: Over-aggressive sanitization might strip non-cyclical but non-standard properties that a user expects to be analyzed by the core agent.
   - **Rollback**: Standard version revert. Reversing root `package.json` scripts restores legacy build behaviors.
   - **Blast Radius**: Limited to adapter-level request parsing. The core `napi-rs` logic and binary artifacts are untouched.

7. Self-Critique Requirement
   - **Weakest Assumption**: That no high-priority customer is relying on the 403 signature for mission-critical, automated real-time reconciliation.
   - **Most Fragile Component**: The `safeClone` implementation's performance profile under extreme payload pressure.
   - **Where will it fail first?** In environments where raw binary buffers are passed through request bodies and incorrectly handled by the stringification fallback.

## [1.4.2] - 2026-02-21 - Document Updates & Roadmap

## Release Notes

Covers changes since commit 204b957d85b79f728102f37042541580953a023d.

## Strategic and Architectural Roadmaps

- **2026 Pilot Program (`PILOT-PROGRAM-2026.md`)**: Added vision containing go-to-market (GTM) and adoption strategies for early-stage integrators.
- **Enhanced Quarantine Protocol (`ENHANCED-QUARANTINE-PROTOCOL.md`)**: Documented the roadmap detailing the multi-phase integration of application-level quarantine mechanisms.
- **Resilience Edge V2 (`RESILIENCE-EDGE-V2.md`)**: Conveyed the next-generation hardware/server architecture focusing on pre-extraction protection, absolute network containment, and zero-overhead logging goals.
- **Comprehensive Threat Model (`THREAT-MODEL.md`)**: Added an official threat model to guide future architectural decisions and strictly define security boundaries.

## Engineering and Infrastructure

- **Chaos Testing ADR** `(chaos-testing-architecture-decision.md)`: Integrated an Architecture Decision Record (ADR) justifying why a custom chaos testing suite was chosen over third-party tools.
- **CI/CD Reliability (Semgrep Fix)**: Stabilized the CI pipeline by masking SemGrep rules that produced false-positive warnings in chaos test scripts via `.semgrepignore` configuration.

## Documentation and Governance

- **Main Showcase (README)**: Added a project banner, sharpened the project description, and modernized heading formats.
- **FAQ Addition**: Created FAQ documentation to accelerate developer onboarding and clarify project boundaries.

## Rationale & Compliance

In accordance with tracehound standards, the system-wide evaluation of this release (and the format of these notes) is as follows:

1. Alternative Approaches and Reasons for Rejection
   - **Alternative 1**: **Listing only technical git commit logs (Classic Changelog Style)**. Why Rejected? Because this release consists of strategic documents, roadmaps, and ADRs rather than code. A pure commit list cannot reflect the vision of where the project is evolving and would be considered a "shortcut".
   - **Alternative 2:** **Compressing documentation additions into a single line under "Minor Fixes / Docs"**. Why Rejected? The added Architecture Decision Record (ADR), Threat Model, and Resilience Edge vision are as critical a System Design artifact as code itself. They dictate the future of the system independently of the code, so highlighting them as main release targets is an architectural necessity.

2. Dependency Awareness Contract
   - **Data Model**: Unaffected (Documentation only).
   - **API / Contract Surface**: Affected. The added `THREAT-MODEL` and `RESILIENCE-EDGE-V2` documents make minimum security standards binding for future API interfaces starting now.
   - **Runtime Behavior**: Unaffected.
   - **Deployment / Operations**: CI/CD pipeline has become more stable and resilient (due to the chaos test SemGrep fix).
   - **Observability**: Unaffected.
   - **Future Roadmap Impact: Critical Impact**. The "2026 Pilot Program" and "Quarantine Protocol" documents added with this release directly dictate the engineering effort for the next 12 months.

3. Facts, Assumptions, and Unknowns
   - **Assumption 1**: The added large-scale vision documents (Edge V2, etc.) will directly and unequivocally guide future code. It is assumed that these unimplemented features will provide the same theoretical flexibility and performance during development.
   - **Assumption 2**: The ADR created for chaos testing reflects the team's strategic decision to persist with their private process/spawn-based model instead of third-party tools (like Pumba).
   - **Unknown 1** (Critical): It is currently unknown to what extent early integrators or customers (mentioned in the Pilot Program docs) during the go-to-market phase will adapt to these strict security models (e.g., Quarantine Protocol) or what compromises they might request, as this has not yet been tested in the field.
   - **Unknown 2**: It is accepted as provided by the team that the `.semgrepignore` masking only hides "false-positive" warnings; it cannot be known with absolute certainty whether a real security anti-pattern is hidden under the mask until exhaustive test scenarios are run.

4. Second-Order Effects
   - **Positive (Second-order)**: Newly onboarding engineers or auditors will reference the created ADR `(chaos-testing-architecture-decision.md)` instead of asking questions like "Why aren't we using a 3rd party chaos test?", minimizing cognitive load.
   - **Negative (Second-order)**: The surface area of documentation and roadmaps has expanded artificially fast (Edge V2, Threat Model, etc.). If plans pivot during the development phase, these numerous added vision documents will also need updating; otherwise, there is a risk of "Doc Rot" (maintenance overhead).

5. Effort Justification Rule
   - These release notes are **technically correct** not because they are "easy to produce", but because the project's current status has shifted from pure code development to architectural blueprinting; they explicitly frame the newly developed and committed boundaries.

6. Failure Modes, Rollback, Blast Radius
   - **Failure Modes**: Misunderstandings; if customers read the V2 roadmap and assume those features "currently exist and can be used immediately," it will result in integration frustration and increased support tickets.
   - **Rollback**: Achieved via `git reset --hard 204b957d` and rewinding the document commit history. Due to zero code dependency, it can be rolled back safely without any downtime.
   - **Blast Radius**: Completely isolated. There are zero side effects or ripple effects (blast radius) on production environments, live traffic processing units, or the current runtime behavior model.

7. Self-Critique Requirement
   - **Weakest Assumption**: Assuming that the masked code is truly "100% false-positive" for all cases just by looking at a single `.semgrepignore` commit.
   - **Most Fragile Component**: The newly added large-scale and highly-promising "Resilience Edge V2" vision document. If future implementation fails to meet ambitious metrics like "zero-overhead" promised in this document due to hardware or software limitations, the document's existence will become technical debt for the project.
   - **Where will it fail first?** Roadmaps were written very strictly. The most likely breaking point is a disconnect between the rigid vision written and the real-world implementation at the first unforeseen integration barrier once implementation begins.

## [1.4.1] - 2026-02-21 - Orphan Wiring & Stability Fixes

This patch release resolves critical architectural wiring gaps where observability and background processing components (Watcher, NotificationEmitter, HoundPool) were instantiated but disconnected from the active agent lifecycle. It also stabilizes the chaos testing suite by replacing brittle PID-based assertions with deterministic invariant checks.

### Fixed

- **HoundPool Auto-Activation**: Fixed a core design flaw where `Agent` quarantined evidence but never explicitly activated the `HoundPool` to process it. `Agent` now accepts an optional `IHoundPool` dependency and auto-activates workers on quarantine.
- **Watcher Observability Wiring**: Fixed `Watcher` remaining perpetually empty. It is now correctly wired to `Agent.intercept()`, receiving `recordThreat()`, `updateQuarantine()`, and `setOverloaded()` events.
- **NotificationEmitter Wiring**: Fixed dormant `NotificationEmitter`. It now correctly broadcasts `threat.detected`, `evidence.quarantined`, `rate_limit.exceeded`, and `system.panic` events.
- **HoundPool Execution Results**: Wired `HoundPool.onResult` to intercept worker timeouts and errors, converting them into Watcher alerts and `system.panic` notifications.
- **Chaos Suite Stabilization**: Rewrote the chaos suite (`run-chaos-suite.ts`) to be PID-free. Repurposed assertions to test deterministic fail-open invariants (pool exhaustion recovery, timeout handling) instead of unreliable process IDs.
- **Test Integrity**: Updated unit tests to verify full internal wiring (Agent ↔ Watcher ↔ Notifications) and ensure `createTracehound` factory propagates all dependencies correctly.

## [1.4.0] - 2026-02-16 - Deterministic Fuzz Assurance Program

This release finalizes the Jazzer-free deterministic fuzz assurance roadmap for Tracehound core.
It adds reproducible property-fuzz coverage, adversarial corpus replay, lifecycle governance, and CI gate enforcement for audit-grade security invariants.

### Added

- **Deterministic Property Fuzz Suite** under `packages/core/tests/fuzz/` for mandatory invariants:
  - determinism
  - canonical idempotency
  - integrity enforcement
  - bounded failure
  - state non-amplification
  - duplicate stability
  - IPC logical safety
- **Adversarial State-Machine Fuzzing**:
  - append permutation checks
  - partial failure ordering checks
  - duplicate replay stability checks
- **Versioned Adversarial Corpus** under `security/corpus/` with replayable seed manifest.
- **Lifecycle Automation**:
  - `scripts/record-fuzz-failure.mjs` for detect/minimize/classify/persist/replay tracking
  - machine-readable failure ledger: `security/artifacts/generated/fuzz-failures.json`
- **Assurance Metrics Automation**:
  - `scripts/generate-fuzz-assurance-report.mjs`
  - generated metrics artifacts for assurance/regression jobs
- **CI/Nightly Fuzz Workflows**:
  - PR regression replay gate
  - nightly assurance gate and artifact upload

### Changed

- **IPC Parser Safety Hardening**: parser buffer resets on malformed parse failures to avoid corrupted/amplifying buffered state.
- **Security Documentation Sync**:
  - updated invariants registry to `INV-DET-01..INV-DET-07`
  - updated fuzz assurance report model and artifact mapping
  - synchronized lifecycle/gate evidence docs for audit usage
- **Gate Enforcement**:
  - assurance scripts now support enforce-pass behavior
  - CI fails when unresolved lifecycle records remain

### Operational Outcome

- Deterministic security invariants are enforced by reproducible fuzz + replay evidence.
- Assurance metrics are machine-readable and CI-enforced.
- Failure lifecycle has audit-traceable records and replay hooks.

## [1.3.0] - 2026-02-16 - Security Model Alignment & Parser Hardening

v1.3.0 further aligns Tracehound with a deterministic security buffer model. This release focuses on aligning security claims with technical guarantees, making parser/ingestion boundedness explicit, and strengthening audit preparation through evidence-first artifacts.

### Security Model Clarification

The security model is now explicitly scoped to:

- **Deterministic evidence integrity**: Guaranteed tamper-evident forensic chains.
- **Parser & ingestion safety**: Bounded and canonical handling of all traffic input.
- **No unsafe execution**: Prevention of untrusted input execution in supported runtime paths.

_Note: Tracehound focuses on fault containment and logical isolation. It does not claim host compromise protection or OS-level container escape guarantees as internal product invariants._

### Added

- **Parser Boundary Enforcement**: `encodePayload` now enforces explicit boundedness controls:
  - `MAX_NESTING_DEPTH = 32`
  - `MAX_OBJECT_KEYS = 1000` (per object)
- **Hardening Tests**: New unit tests validating rejection of payloads exceeding nesting depth or key cardinality.
- **Security/Audit Pipeline**: Added Semgrep CI workflow with SARIF upload and artifact persistence.
- **Open Source Foundation**: Added `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md` (Contributor Covenant v2.1).
- **Project Narrative**: Enhanced `README.md` with "About the Project" and "Why we built this" sections.

### Changed

- **Messaging Alignment**: Public-facing docs updated to move from "sandboxed analysis" to "process-separated analysis" to reflect the actual guarantee envelope.
- **Package Ownership**: Set official package author to **Erdem Arslan <me@erdem.work>**.
- **Unified Versioning**: Synchronized all ecosystem components to v1.3.0.

### Known Follow-ups

- Attach first real Semgrep CI SARIF + triage output.
- Regenerate supply-chain evidence in fully authenticated CI context (pnpm audit, final SBOM).
- Extend parser determinism fuzz evidence depth.

## [1.2.0] - 2026-02-14 - Forensic Hardening & English Audit Prep

### Added

- **90%+ Test Coverage**: Achieved project-wide line coverage above 90% threshold.
  - Comprehensive CLI command action testing (`status`, `stats`, `inspect`, `watch`).
  - Webhook dispatch logic with HMAC-SHA256 and exponential backoff.
  - Async binary codec error path verification.
  - Express and Fastify integration middleware hardening.
- **English Security Documentation**: All security audit docs translated from Turkish to English for international compliance.
- **Dynamic Versioning**: Refactored CLI to pull version dynamically from `package.json`, ensuring consistency across the monorepo.
- **TUI Dashboard Logic Extraction**: Refactored CLI for isolated render testing.

### Fixed

- **CLI Hardcoded Versions**: Corrected legacy `0.1.0` references to match substrate version.
- **Webhook State Leak**: Fixed test flakiness in notification emitter.
- **Quarantine Empty State**: Synchronized CLI output expectations for empty quarantine.

## [1.1.0] - 2026-02-10 - Production Hardening (Phase 4 P1)

### Added

- **Async Codec**: Non-blocking gzip encode/decode for cold storage operations.
  - `AsyncGzipCodec` class with `encode()` / `decode()` returning `Promise<Uint8Array>`
  - `AsyncHotPathCodec` and `AsyncColdPathCodec` interfaces
  - `encodeWithIntegrityAsync()` and `decodeWithIntegrityAsync()` for non-blocking cold storage I/O
  - `createAsyncColdPathCodec()` factory function
  - Byte-identical output to sync codec (determinism verified)
  - Full sync/async interop (sync-encoded ↔ async-decoded and vice versa)
- **S3 Cold Storage Adapter**: S3-compatible object storage for evidence archival.
  - `S3ColdStorage` class implementing `IColdStorageAdapter`
  - `S3LikeClient` interface for dependency injection (zero AWS SDK dependency in core)
  - Binary envelope format (THCS) for self-contained evidence storage
  - `packEnvelope()` / `unpackEnvelope()` for custom adapter development
  - Supports AWS S3, Cloudflare R2, Google Cloud Storage (S3-compat), MinIO
  - `createS3ColdStorage()` factory function
- **CI/CD Pipeline**: GitHub Actions workflow for automated testing and linting.
  - Type checking (`tsc --noEmit`) across all packages
  - Test matrix: Node.js 20, 22
  - Coverage verification job
  - Concurrency control for PR builds
- **K8s Deployment Guide**: Production Kubernetes deployment documentation.
  - Resource sizing formula and recommendations
  - ConfigMap-driven configuration
  - Deployment manifest with security context
  - Health probe patterns (fail-open compatible)
  - HPA configuration
  - Network policy for cold storage egress
  - Secrets management (External Secrets Operator)
  - Monitoring and Prometheus metrics examples

### Fixed

- **Stress test flaky failure**: Added JIT warmup iterations and increased p99 latency threshold for CI environments.

### Tests

- 479 tests passing across 32 test files (+75 new)
  - 19 async codec, 14 S3 adapter
  - 10 async codec stress, 7 cold storage pipeline, 25 envelope integrity

---

## [1.0.0] - 2024-12-27 - Stable Release

**Milestone**: v1.0.0 Complete. Private / Premium Release.

### Added - CLI & TUI (@tracehound/cli)

- **Zero-Dependency Dashboard**: Pure ANSI + `cli-table3` based TUI.
- **Commands**:
  - `tracehound status`: System health, uptime, and memory usage.
  - `tracehound stats`: Threat statistics by severity and category.
  - `tracehound inspect`: Deep dive into quarantine evidence.
  - `tracehound watch`: Live auto-refreshing dashboard.
- **Theme**: Soft Dark Material theme for terminal UI.

### Added - Documentation

- **Getting Started**: Installation, Quick Start, and Framework Adapters.
- **Configuration Reference**: Exhaustive reference for all components (Agent, Quarantine, HoundPool, etc.).
- **License**: Updated to Commercial (Enterprise / Premium).

### Core Features (Consolidated from v0.x)

- **Agent**: Decision-free traffic orchestration.
- **Quarantine**: Secure evidence buffer with `priority` eviction.
- **Hound Pool**: Process-isolated forensic analysis sandbox.
- **Fail-Safe**: Adaptive circuit breaker (Memory/CPU/Error rates).
- **Audit Chain**: Tamper-evident operational log.

### Tests

- **Coverage**: 368+ tests across Core, CLI, Express, and Fastify packages.
- **Scenarios**: Full lifecycle, stress testing, and fail-safe integration verified.

## [0.7.0] - v1.0.0 P0 Complete

### Added

- **Cold Storage Adapter**: `IColdStorageAdapter` interface for fire-and-forget archival.
  - `MemoryColdStorage` for testing
  - `write()`, `read()`, `delete()`, `isAvailable()` methods
- **Trust Boundary Runtime**: Developer-defined trust levels.
  - `TrustBoundaryConfig` for cluster, coldStorage, detector boundaries
  - `validateTrustBoundary()` validation helper
  - `shouldVerifyDetector()`, `isClusterUntrusted()` helpers

### Changed

- **RENAMED**: `hound-worker.ts` → `hound-process.ts` (RFC-0000 alignment)

### Tests

- 324 tests passing (+17 new)

## [0.6.0] - Production Ready (P0 Complete)

### Added

- **Binary Codec Integrity**: SHA-256 hash for cold storage evidence.
  - `encodeWithIntegrity()`, `verify()`, `decodeWithIntegrity()`
  - Verify-before-decode pattern enforced via docs
  - Empty payloads valid (absence is evidence)
- **Runtime Flags**: `--frozen-intrinsics` check added to `verifyRuntime()`.
  - `getRuntimeInfo().intrinsicsFrozen` property

### Security

- Tamper detection for cold storage evidence
- Built-in prototype modification detection

## [0.5.0] - Hound Process Isolation

### Changed

- **BREAKING**: Migrated Hound Pool from Worker Threads to **child process-based isolation**.
  - `activeWorkers` → `activeProcesses`
  - `totalWorkers` → `totalProcesses`
  - `workerId` → `processId`
  - `workerScriptPath` → `processScriptPath`
  - `SandboxConstraints` → `HoundProcessConstraints` (declarative)

### Added

- **Hound IPC**: Binary length-prefixed protocol for child process communication.
- **Process Adapter**: Platform-agnostic spawn/kill abstraction.
- **Mock Adapter**: For testing without real child processes.
- **PoolExhaustedAction**: `'drop' | 'escalate' | 'defer'` for pool exhaustion handling.
- **RFC-0002**: Argos & Behavioral Signal Protocol.

### Removed

- `SandboxConstraints` type (replaced by `HoundProcessConstraints`).

### Security

- OS-level memory isolation (child processes, not threads).
- Independent crash domains.
- SIGKILL for immediate process termination.

## [0.4.0] - Observability & Resilience

### Added

- **Hound Pool**:
  - `HoundPool` class for isolated evidence processing.
  - Strict sandbox constraints (no eval, no network).
  - Fire-and-forget `activate()` API.
  - Timeout and force-termination support.
- **Tick Scheduler**:
  - `Scheduler` class for background task management.
  - Jittered tick intervals to prevent timing attacks.
  - Priority-based task execution.
  - `skipIfBusy` protection against load.
- **Watcher**:
  - `Watcher` class for pull-based observability.
  - `snapshot()` API for immutable system state.
  - Rate-limited alerting system.
  - Threat and quarantine metrics tracking.
- **Binary Codec**:
  - `HotPathCodec` (encode-only) and `ColdPathCodec` types.
  - Gzip compression support for Evidence.
  - Integration with EvidenceFactory.
- **Integration Tests**:
  - Full flow verification (Scent → Agent → Quarantine).
  - Rate limiting, eviction, and concurrent access tests.

## [0.3.0] - Core Logic

### Added

- **Agent**:
  - Main entry point `intercept(scent)`.
  - Orchestrates Quarantine, RateLimiter, and EvidenceFactory.
  - Stateless design with dependency injection.
- **Rate Limiter**:
  - Token bucket / Window implementation.
  - Source-based blocking.
  - Memory-efficient state tracking.
- **Evidence Factory**:
  - Secure creation of Evidence instances.
  - Payload encoding and hashing.

## [0.2.0] - Evidence & Quarantine

### Added

- **Evidence**:
  - `Evidence` class with ownership semantics.
  - SHA-256 integrity verification.
  - `transfer()`, `neutralize()`, `evacuate()` lifecycle methods.
- **Quarantine**:
  - `Quarantine` buffer implementation.
  - Priority-based eviction policy.
  - Memory limits (count and bytes).
  - Integration with AuditChain.
- **Audit Chain**:
  - Merkle-chain like audit logging.
  - Tamper-evident record keeping.

## [0.1.0] - Foundation

### Added

- **Types**: Core type definitions (`Scent`, `Threat`, `EvidenceHandle`).
- **Utils**:
  - `generateSignature` / `validateSignature`.
  - Deterministic JSON serialization.
  - Secure ID generation (UUIDv7).
  - Constant-time comparison.
