# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- **Working Memory RFC**: RFC-0001 accepted for O(1) in-memory state management.

## [0.4.0] - Phase 4: Observability & Resilience

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

## [0.3.0] - Phase 3: Core Logic

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

## [0.2.0] - Phase 2: Evidence & Quarantine

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

## [0.1.0] - Phase 1: Foundation

### Added

- **Types**: Core type definitions (`Scent`, `Threat`, `EvidenceHandle`).
- **Utils**:
  - `generateSignature` / `validateSignature`.
  - Deterministic JSON serialization.
  - Secure ID generation (UUIDv7).
  - Constant-time comparison.
