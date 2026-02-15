# Attack Surface

## Entry Point Inventory

| Surface          | Entry Point                                      | Input Type                        | Primary Validation                                   | Primary Sink                              | Risk       |
| ---------------- | ------------------------------------------------ | --------------------------------- | ---------------------------------------------------- | ----------------------------------------- | ---------- |
| HTTP middleware  | `packages/fastify/src/index.ts` `onRequest` hook | Request headers/query/body/path   | `Agent.intercept` + payload encoding/size validation | `Quarantine.insert`, `HoundPool.activate` | High       |
| HTTP middleware  | `packages/express/src/index.ts` middleware       | Request headers/query/body/path   | `Agent.intercept` + payload encoding/size validation | `Quarantine.insert`, `HoundPool.activate` | High       |
| Core API         | `Agent.intercept(scent)`                         | `Scent` object from integrations  | `RateLimiter.check` + `EvidenceFactory.create`       | Quarantine/audit updates                  | High       |
| Process boundary | `createProcessAdapter().spawn(...)`              | Script path + process constraints | Internal adapter checks + runtime flags              | OS child process + IPC                    | High       |
| IPC parser       | Hound IPC message parser                         | Binary frames from child process  | Message framing/parser logic                         | Result handlers, pool state               | Medium     |
| CLI              | `inspect/status/stats/watch` commands            | Local operator arguments          | Commander option parsing (limited)                   | Console output/state views                | Low-Medium |

## Initial Observations

- The highest-risk paths are request ingestion and process spawning/IPC.
- Quarantine and evidence creation are central sinks and must remain deterministic + bounded.
- CLI commands are mostly observability features today and currently use placeholder data in several commands.

## Gaps to Close

- [x] Add exact code references (function-level) for each sink (see `security/artifacts/rce-spawn-inventory.md` + core tests).
- [x] Add input-size/pathological input scenarios for key entry points (see DoS and parser artifacts).
- [x] Add explicit note for unsupported/non-goals per surface in audit review notes.
- [x] Cross-link each high-risk entry to corresponding invariant IDs in `security/invariants.md`.
