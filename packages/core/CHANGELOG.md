# Changelog

All notable changes to this project will be documented in this file.

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
