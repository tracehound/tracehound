# Configuration Reference

> **Status:** Active
> **Scope:** Runtime and adapter configuration defaults

---

This document is the dedicated configuration entry point for Tracehound.

For complete option schemas and adapter-specific behavior flags, see:

1. [API & Configuration Reference](./API.md)
2. [Getting Started](./GETTING-STARTED.md)
3. [Breaking Changes / Migration](./BREAKING-CHANGES.md)

## What This Covers

1. Core runtime options and defaults
2. Adapter behavior flags (Express/Fastify)
3. Safety and fail-open configuration expectations

## Quarantine Decay Configuration

`TracehoundOptions.quarantine` now covers active-surface expiry and background archival:

```ts
createTracehound({
  quarantine: {
    maxCount: 10_000,
    maxBytes: 100_000_000,
    ttlMs: 86_400_000,
    decayIntervalMs: 1000,
    decayBatchSize: 128,
    archiveOnDecay: true,
    archiveFailureMode: 'drop',
    archiveTimeoutMs: 5_000,
  },
})
```

Operational meaning:

1. `ttlMs`: how long evidence stays in active quarantine before background decay is eligible.
2. `decayIntervalMs`: cadence for background expiry checks.
3. `decayBatchSize`: upper bound for expired items processed per decay run.
4. `archiveOnDecay`: whether expired evidence should be written to cold storage before removal.
5. `archiveFailureMode`:
   - `drop`: prefer bounded active state over forensic completeness.
   - `retain`: keep expired evidence resident until archival succeeds.
6. `archiveTimeoutMs`: deadline for a single cold storage write; prevents a slow adapter from blocking decay indefinitely.

If TTL decay is enabled, no custom cold storage adapter is supplied, and `archiveOnDecay` is not explicitly disabled, Tracehound provisions the built-in memory-first adapter automatically.

## Pressure Containment Configuration

`TracehoundOptions.pressure` controls OSS pressure thresholds without exposing a full control plane:

```ts
createTracehound({
  pressure: {
    elevatedWatermark: 0.8,
    criticalWatermark: 0.95,
    recoverToElevatedWatermark: 0.85,
    recoverToNormalWatermark: 0.7,
    recoveryCooldownMs: 5_000,
  },
})
```

Operational meaning:

1. `elevatedWatermark`: quarantine capacity ratio that raises mode to `elevated`.
2. `criticalWatermark`: quarantine capacity ratio that raises mode to `critical`.
3. `recoverToElevatedWatermark`: lower bound needed to leave `critical`.
4. `recoverToNormalWatermark`: lower bound needed to leave `elevated`.
5. `recoveryCooldownMs`: quiet period before pressure recovery is allowed.

Runtime invariants:

1. Thresholds must satisfy `0 < recoverToNormalWatermark < elevatedWatermark < recoverToElevatedWatermark < criticalWatermark <= 1`.
2. `recoveryCooldownMs` must normalize to a positive integer millisecond value.
3. Invalid combinations fail fast during `createTracehound()` initialization with a pressure config error.

Safety rules remain fixed even when thresholds are customized:

1. `quarantine.maxBytes`, `quarantine.maxCount`, and `maxPayloadSize` remain hard caps.
2. `critical` pressure suppresses decay-time archival to protect host survivability.
3. TTL decay still runs under pressure; expired evidence is removed deterministically even when archival is suppressed.
4. OSS runtime exposes pressure through snapshots, CLI `status/watch`, and notification events only; it does not expose policy hooks or operator overrides.

## Canonical Rule

`API.md` remains the canonical technical definition for option shapes.
This file is maintained as a stable configuration index to avoid broken links across release notes and roadmap artifacts.

## Snapshot Configuration

Runtime operational snapshot export is configured via `TracehoundOptions.snapshot`:

```ts
createTracehound({
  snapshot: {
    path: '/var/run/tracehound/system-snapshot.json',
    secret: process.env.TRACEHOUND_SNAPSHOT_SECRET,
    intervalMs: 1000,
  },
})
```

Security requirements:

1. Snapshot export is enabled only when a deterministic secret exists.
2. Secret source is explicit config or `TRACEHOUND_SNAPSHOT_SECRET`.
3. If secret is missing, initialization fails with config error.
4. Snapshot file is HMAC-signed and must be verified before use.

Platform notes:

1. POSIX file mode is `0600` best-effort.
2. Windows ACL enforcement is best-effort only in Node runtime; strict ACL hardening must be done at host level.

## CLI Runtime Snapshot Inputs

CLI commands (`status`, `stats`, `watch`) read:

1. `TRACEHOUND_SYSTEM_SNAPSHOT_PATH` (snapshot file path)
2. `TRACEHOUND_SNAPSHOT_SECRET` (verification secret)
3. `TRACEHOUND_SNAPSHOT_MAX_AGE_MS` (optional freshness window override, default `5000`)
4. `TRACEHOUND_SNAPSHOT_MAX_FUTURE_SKEW_MS` (optional future timestamp skew tolerance, default `5000`)

Programmatic key access is available via `SYSTEM_SNAPSHOT_ENV`:

```ts
import { SYSTEM_SNAPSHOT_ENV } from '@tracehound/core'

process.env[SYSTEM_SNAPSHOT_ENV.PATH] = '/var/run/tracehound/system-snapshot.json'
process.env[SYSTEM_SNAPSHOT_ENV.SECRET] = 'shared-secret'
process.env[SYSTEM_SNAPSHOT_ENV.MAX_AGE_MS] = '5000'
process.env[SYSTEM_SNAPSHOT_ENV.MAX_FUTURE_SKEW_MS] = '5000'
```

If snapshot cannot be trusted:

1. `NO_INSTANCE` when file is absent or stale.
2. `INTEGRITY_VIOLATION` when signature/format/secret validation fails or snapshot timestamp is implausibly in the future.

### Snapshot file lifecycle

While a Tracehound instance is running with snapshot export enabled, the runtime maintains the snapshot file at `TRACEHOUND_SYSTEM_SNAPSHOT_PATH` and updates it on the configured interval.
On graceful shutdown via `Tracehound.shutdown()`, the runtime removes this snapshot file as part of cleanup.
After this removal, CLI commands will report `NO_INSTANCE` once the absence is observed, regardless of the configured freshness window; this is expected and indicates that the instance has shut down cleanly rather than an integrity failure.
