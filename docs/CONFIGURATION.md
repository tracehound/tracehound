# Configuration Reference

> **Status:** Active
> **Scope:** Runtime and adapter configuration defaults

---

This document is the dedicated configuration entry point for Tracehound.

For complete option schemas and adapter-specific behavior flags, see:

1. [API & Configuration Reference](./API.md)
2. [Getting Started](./GETTING-STARTED.md)

## What This Covers

1. Core runtime options and defaults
2. Adapter behavior flags (Express/Fastify)
3. Safety and fail-open configuration expectations

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

If snapshot cannot be trusted:

1. `NO_INSTANCE` when file is absent.
2. `INTEGRITY_VIOLATION` when signature/format/secret validation fails.
