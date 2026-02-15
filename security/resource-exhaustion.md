# DoS & Resource Exhaustion Testing

## Objective

Define boundedness checks for memory, queueing, parser behavior, and event-loop stability.

## High-Risk DoS Vectors

1. Oversized payload serialization/encoding pressure
2. Worker pool exhaustion and deferred queue growth
3. IPC message flood / malformed frame churn
4. Event-loop blocking caused by pathological inputs
5. Descriptor/process leak from worker lifecycle failures

## Current Defenses Identified

| Vector              | Existing Control                                                                 | Location                              | Maturity |
| ------------------- | -------------------------------------------------------------------------------- | ------------------------------------- | -------- |
| Payload size        | `maxPayloadSize` validation in encoding flow                                     | `encode.ts`, `agent.ts`               | Medium   |
| Worker exhaustion   | `onPoolExhausted` strategies (`drop`, `escalate`, `defer`) + bounded defer queue | `hound-pool.ts`                       | Medium   |
| IPC oversized frame | `MAX_MESSAGE_SIZE` check                                                         | `hound-ipc.ts`                        | Medium   |
| Long-running worker | timeout and terminate logic in pool/adapter path                                 | `hound-pool.ts`, `process-adapter.ts` | Medium   |

## Gaps to Address

- [ ] No benchmark artifact for worst-case event-loop blocking.
- [ ] No published memory/latency curve under sustained adversarial load.
- [ ] Regex worst-case analysis is not documented yet.
- [ ] File descriptor leak checks are not documented yet.

## Required Artifacts

- `security/artifacts/dos-load-profile.md` (baseline created)
- `security/artifacts/event-loop-delay-scan.md` (baseline created)
- `security/artifacts/worker-pool-exhaustion-results.md` (baseline created)

## Exit Criteria

- A bounded operating envelope is stated (input size, queue limits, timeout behavior).
- At least one stress scenario per high-risk vector includes measurable output.
