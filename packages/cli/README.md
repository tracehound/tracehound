# @tracehound/cli

CLI and TUI tools for inspecting a running Tracehound runtime.

## Installation

```bash
pnpm add -g @tracehound/cli
# or
npm install -g @tracehound/cli
```

Local usage:

```bash
pnpm dlx @tracehound/cli --help
```

## Commands

```bash
tracehound status [--json]
tracehound stats [--json] [--since <duration>]
tracehound inspect [trace-id] [--trace-id <id>] [--signature <sig>] [--limit <n>] [--json]
tracehound watch [--refresh <ms>]
tracehound history clear [--json]
tracehound disk clear [--json]
```

## Snapshot-backed Commands

`status`, `stats`, and `watch` read signed runtime snapshots written by `@tracehound/core`.

Required environment variables:

- `TRACEHOUND_SYSTEM_SNAPSHOT_PATH`
- `TRACEHOUND_SNAPSHOT_SECRET`

Optional validation overrides:

- `TRACEHOUND_SNAPSHOT_MAX_AGE_MS` (default `5000`)
- `TRACEHOUND_SNAPSHOT_MAX_FUTURE_SKEW_MS` (default `5000`)

Snapshot truth semantics:

- stale or missing snapshot => `NO_INSTANCE`
- bad signature or future-skew violation => `INTEGRITY_VIOLATION`

Example:

```bash
export TRACEHOUND_SYSTEM_SNAPSHOT_PATH=/var/run/tracehound/system-snapshot.json
export TRACEHOUND_SNAPSHOT_SECRET=replace-me
tracehound status
```

## Inspect and Trace Registry Workflow

`inspect`, `history clear`, and `disk clear` operate on the local trace registry.

Optional environment variable:

- `TRACEHOUND_TRACE_REGISTRY_PATH` to override the default trace-registry location used by inspect/history/disk commands

Typical flow:

1. Enable `emitTraceIdHeader: true` in Express/Fastify adapter.
2. Capture `x-tracehound-trace-id` from a quarantined response.
3. Run `tracehound inspect --trace-id <id>`.

Lifecycle commands:

- `tracehound history clear` clears logical inspection history while preserving the registry file path
- `tracehound disk clear` removes persisted local trace-registry data from disk
- `tracehound inspect` returns trace-registry metadata only; forensic payload bytes remain quarantine-local and are never exposed by the CLI

## Output Modes

- Human-readable table output by default
- `--json` for machine-readable pipelines

## Related Packages

- [@tracehound/core](../core/README.md)
- [@tracehound/express](../express/README.md)
- [@tracehound/fastify](../fastify/README.md)

## Further Reading

- [API Reference](../../docs/API.md)
- [Configuration](../../docs/CONFIGURATION.md)
- [Supply Chain & Release Boundary](../../security/supply-chain.md)

## License

Apache-2.0
