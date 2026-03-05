# Breaking Changes and Migration Guide

> Last Updated: 2026-03-06
> Target: next release after `v1.5.0`

This page tracks behavior and contract changes that require migration work.

## 1) `@tracehound/fastify` default export removed

### Impact

Code using default import will fail at build/runtime after upgrade.

### Before

```ts
import tracehoundPlugin from '@tracehound/fastify'
```

### After

```ts
import { tracehoundPlugin } from '@tracehound/fastify'
```

## 2) `IAgent` contract parity: `getStats()` required

### Impact

If you maintain a custom `IAgent` implementation, you must now implement:

```ts
getStats(): Readonly<AgentStats>
```

### Why

Operational tooling and snapshot exports depend on canonical agent stats from interface surface, not implementation details.

## 3) CLI no longer fabricates healthy/default-zero state

Commands `tracehound status`, `tracehound stats`, and `tracehound watch` now require a verified runtime snapshot.

### New failure modes

1. `NO_INSTANCE`: snapshot file not found or stale.
2. `INTEGRITY_VIOLATION`: missing/invalid secret, invalid format, signature mismatch, or implausibly future-dated snapshot timestamp.

### Required runtime configuration

1. Produce signed snapshot from app runtime (`TracehoundOptions.snapshot`).
2. Provide deterministic secret (`snapshot.secret` or `TRACEHOUND_SNAPSHOT_SECRET`).
3. Set CLI path/secret env vars:
   - `TRACEHOUND_SYSTEM_SNAPSHOT_PATH`
   - `TRACEHOUND_SNAPSHOT_SECRET`
   - Optional: `TRACEHOUND_SNAPSHOT_MAX_AGE_MS` (default 5000)
   - Optional: `TRACEHOUND_SNAPSHOT_MAX_FUTURE_SKEW_MS` (default 5000)

## 4) Snapshot export now enforces secret presence

If `TracehoundOptions.snapshot` is enabled and no secret resolves, initialization fails with typed config error.

This is intentional and prevents unsigned or unverifiable operational state.

## 5) Windows ACL note (security limitation)

Snapshot file permission hardening is strict on POSIX (`0600` best-effort), but Windows ACL enforcement is best-effort in Node runtime.

Use host-level ACL policy for strict production controls on Windows.

## Appendix A) Non-breaking additions (informational)

### Operational env key constants (recommended)

This is additive and does not require migration work.

`@tracehound/core` exposes `SYSTEM_SNAPSHOT_ENV` for snapshot env key access:

- `PATH` -> `TRACEHOUND_SYSTEM_SNAPSHOT_PATH`
- `SECRET` -> `TRACEHOUND_SNAPSHOT_SECRET`
- `MAX_AGE_MS` -> `TRACEHOUND_SNAPSHOT_MAX_AGE_MS`
- `MAX_FUTURE_SKEW_MS` -> `TRACEHOUND_SNAPSHOT_MAX_FUTURE_SKEW_MS`

This avoids hard-coded env key strings in application and tooling code.
