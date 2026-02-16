# Attack Surface

## Entry Point Inventory

| Surface          | Entry Point                                      | Input Type                      | Primary Validation                                   | Primary Sink                              | Risk       | Invariants          |
| ---------------- | ------------------------------------------------ | ------------------------------- | ---------------------------------------------------- | ----------------------------------------- | ---------- | ------------------- |
| HTTP middleware  | `packages/fastify/src/index.ts` `onRequest` hook | Request headers/query/body/path | `Agent.intercept` + payload encoding/size validation | `Quarantine.insert`, `HoundPool.activate` | High       | INV-DET-01,04,05,06 |
| HTTP middleware  | `packages/express/src/index.ts` middleware       | Request headers/query/body/path | `Agent.intercept` + payload encoding/size validation | `Quarantine.insert`, `HoundPool.activate` | High       | INV-DET-01,04,05,06 |
| Core API         | `Agent.intercept(scent)`                         | `Scent` object                  | `RateLimiter.check` + `EvidenceFactory.create`       | Quarantine/audit updates                  | High       | INV-DET-01..06      |
| Process boundary | `createProcessAdapter().spawn(...)`              | Script path + constraints       | Adapter checks + runtime flags                       | OS child process + IPC                    | High       | INV-DET-07          |
| IPC parser       | Hound IPC message parser                         | Binary frames                   | Message framing/parser logic                         | Result handlers, pool state               | Medium     | INV-DET-07          |
| CLI              | `inspect/status/stats/watch` commands            | Local operator arguments        | Commander parsing                                    | Console output/state views                | Low-Medium | N/A                 |

## Current Assurance Notes

- The highest-risk paths are request ingestion and process spawning/IPC.
- Quarantine and evidence creation are central sinks and must remain deterministic + bounded.
- CLI commands are mostly observability features today and currently use placeholder data in several commands.

## Gaps to Close

- Highest-risk paths remain request ingestion and process/IPC boundaries.
- Quarantine/evidence sinks are treated as deterministic state-critical surfaces.
- Fuzz assurance now prioritizes invariant outcomes over coverage percentage.
