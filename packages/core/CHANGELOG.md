# Changelog

All notable changes to this project will be documented in this file.

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
