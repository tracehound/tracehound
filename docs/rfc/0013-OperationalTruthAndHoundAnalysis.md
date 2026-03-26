# RFC-0013: Operational Truth and Hound Analysis

## Title and Metadata

| Field | Value |
| --- | --- |
| RFC | 0013 |
| Status | Implemented |
| Author | Core Maintainers |
| Created | 2026-03-05 |
| Depends on | RFC-0000, RFC-0011 |
| Implemented in | `packages/core/src/core/tracehound.ts`, `packages/core/src/utils/system-snapshot.ts`, `packages/core/src/core/hound-process.ts`, `packages/core/src/core/hound-ipc.ts`, `packages/core/src/core/hound-pool.ts`, `packages/cli/src/commands/*.ts` |

## Motivation

Operational tooling currently risks showing fabricated healthy state when no live runtime is connected. In a security product, this creates false assurance during incidents.

In parallel, Hound child execution existed as process-isolation wiring without deterministic analysis metadata, reducing forensic value.

This RFC introduces two guarantees:

1. CLI operational views must be grounded in signed runtime snapshot data, never fabricated defaults.
2. Hound child processing must emit deterministic analysis metadata (`hash`, `entropy`, `contentType`, `sizeBytes`) over the existing binary IPC channel.

## Design

### 1) Signed System Snapshot

A new snapshot utility layer exports runtime state and writes signed files atomically.

- Snapshot type: `SystemSnapshot`
- Read utility: `readSystemSnapshotFromDisk(path, secret)`
- Write utility: `writeSystemSnapshotToDisk(snapshot, path, secret)`
- Signature: HMAC-SHA256 over serialized payload
- Verification: constant-time compare
- Write semantics: `.tmp` + rename atomic swap
- File permissions:
  - POSIX: `0600` best-effort
  - Windows: ACL enforcement is best-effort only; explicit limitation documented

Secret source is deterministic and shared:

- explicit `TracehoundOptions.snapshot.secret`, or
- `TRACEHOUND_SNAPSHOT_SECRET`

If snapshot export is configured and no secret resolves, initialization fails with typed config error.

### 2) Public API Parity

- `IAgent` now includes `getStats(): Readonly<AgentStats>`
- `ITracehound` now includes `snapshot(): SystemSnapshot`
- `TracehoundOptions` now includes:

```ts
snapshot?: {
  path: string
  secret?: string
  intervalMs?: number
}
```

### 3) CLI Operational Truth Wiring

`status`, `stats`, and `watch` now load signed snapshot files and fail explicitly when unavailable.

Failure modes shown to operator:

- `NO_INSTANCE`
- `INTEGRITY_VIOLATION`

No command may fabricate healthy/default-zero state when runtime snapshot is unavailable.

### 4) Hound Deterministic Analysis

`hound-process` now performs deterministic payload analysis and emits a new IPC message type:

- `type: 'analysis'`
- `hash` (SHA-256)
- `entropy` (Shannon)
- `contentType` (magic-byte + text/json hint)
- `sizeBytes`

IPC protocol extension is additive:

- `HoundMessage` union includes `analysis`
- `HoundResult.analysis?` carries metadata to parent

### 5) Pressure Model Alignment (Decision-Free)

This RFC does not introduce threat decisions in Agent hot path.

Pressure containment remains RFC-0011 aligned:

- bounded defer queue
- deterministic drop-and-count under pressure
- overload signaling (`Watcher.setOverloaded`) and observability

No inline fast-check verdicts are added.

## Security Considerations

- Signed snapshots prevent tampered operational state from being treated as trusted.
- Secret material is not auto-randomized per instance; deterministic source prevents split-brain verification failures.
- Constant-time comparison avoids signature timing leaks.
- Windows ACL limitations are explicit; deployments requiring strict ACL guarantees must configure host-level controls.
- Process isolation hardening removes full parent env inheritance in child spawn path (minimal allowlist only).
- Core error model uses typed `Errors` factories; uncategorized `throw new Error(...)` in core runtime paths is removed.

Fail-open invariant remains unchanged for request processing.

## Performance Impact

- Snapshot export is periodic (default 1000ms) and write-amortized by atomic file replacement.
- Hound deterministic analysis adds bounded CPU work per payload (hash + entropy + lightweight fingerprint).
- IPC payload size increases slightly for `analysis` messages.
- No synchronous blocking is introduced into Agent intercept hot path.

## Backward Compatibility

- IPC extension is additive.
- Public API changes are additive but may require interface parity updates for custom `IAgent` implementors.
- CLI behavior changes from fabricated defaults to explicit connection/integrity errors.
- Existing adapters remain thin wrappers; no HTTP mapping changes.

## Test Plan

1. Core unit/integration tests:
   - `pnpm --filter @tracehound/core test`
2. CLI tests for snapshot truth behavior:
   - `pnpm --filter @tracehound/cli test`
3. Adapter smoke tests:
   - `pnpm --filter @tracehound/express test`
   - `pnpm --filter @tracehound/fastify test`
4. Scenario suite:
   - `pnpm exec vitest run scenarios` (in `packages/core`)
5. Lint/type gates:
   - `pnpm lint`

Acceptance checks:

- CLI reports `NO_INSTANCE` when snapshot is absent.
- CLI reports `INTEGRITY_VIOLATION` when signature check fails.
- `HoundResult.analysis` is populated on processed results.
- No fabricated healthy/default-zero status output in `status/stats/watch` without valid snapshot.

## Alternatives Considered

- Runtime daemon IPC channel (named pipe/UDS) for CLI
- Rejected for patch wave due complexity and rollout risk.

---

- Inline fast-check decision path in Agent
- Rejected due RFC-0000 decision-free invariant.

---

- Per-instance random snapshot secret default
- Rejected because multi-process operational tooling needs deterministic verification source.

---

- Claiming strict Windows ACL enforcement in Node-only path
- Rejected; only best-effort is possible without host-level controls.
