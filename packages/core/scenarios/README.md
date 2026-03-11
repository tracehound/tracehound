# Core Scenarios

Scenario-level and stress-oriented tests for `@tracehound/core`.

These files validate cross-subsystem behavior under load, decay, archival, and forensic integrity constraints.

## Current Scenario Suite

- `full-lifecycle.test.ts`: end-to-end Scent -> Evidence -> Quarantine flow
- `stress.test.ts`: high-volume stress behavior
- `ipc-stress.test.ts`: hound-process IPC stress
- `fail-safe-integration.test.ts`: panic and recovery integration
- `pressure-containment-suite.test.ts`: bounded behavior under pressure
- `cold-storage-pipeline.test.ts`: decay + cold storage pipeline
- `envelope-integrity.test.ts`: integrity and envelope checks
- `async-codec-stress.test.ts`: async codec stress and fidelity

## Running Scenarios

From repository root:

```bash
pnpm --filter @tracehound/core test -- scenarios/full-lifecycle.test.ts
pnpm --filter @tracehound/core test -- scenarios/stress.test.ts
```

Run all scenario tests:

```bash
cd packages/core
npx vitest run scenarios/*.test.ts
```

## Notes

- `server/` and `utils/` directories are reserved for scenario support assets.
- Scenarios complement unit tests; they do not replace package test gates.
