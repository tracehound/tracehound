# RFC-0009: External Coordination Provider Contract

## Title and Metadata

| Field          | Value                  |
| -------------- | ---------------------- |
| RFC            | 0009                   |
| Status         | Draft                  |
| Author         | Tracehound Engineering |
| Created        | 2026-03-03             |
| Updated        | 2026-03-03             |
| Depends on     | RFC-0000               |
| Supersedes     | None                   |
| Implemented in | TBD                    |

## Motivation

Tracehound roadmap milestone M3 requires an explicit external coordination boundary for Horizon-aligned capabilities without introducing hidden hard dependencies into core execution. The system needs a contract-first model for multi-instance synchronization while preserving fail-open behavior and deterministic core semantics.

Problems addressed:

1. No canonical type-level contract for external coordination providers.
2. No standardized health mode representation for degraded synchronization.
3. Risk of accidental coupling between coordination concerns and hot-path security logic.

## Design

### Contract Types

```ts
export type CoordinationFeature =
  | 'shared_blocklist'
  | 'global_rate_limit'
  | 'mtls_enforcement'
  | 'policy_broker'

export type CoordinationMode = 'local' | 'degraded' | 'synchronized'

export interface CoordinationHealth {
  readonly mode: CoordinationMode
  readonly lastSyncAt: number | null
  readonly syncLagMs: number | null
  readonly provider: string
}

export interface CoordinationProvider {
  readonly providerId: string
  readonly features: ReadonlySet<CoordinationFeature>
  start(): Promise<void>
  stop(): Promise<void>
  health(): CoordinationHealth
  syncBlocklist?(entries: ReadonlyArray<string>): Promise<void>
  syncRateLimit?(bucketKey: string, value: number): Promise<void>
}
```

### Behavioral Rules

1. Coordination is optional. If no provider is configured, mode is `local`.
2. Provider failures switch to `degraded` without interrupting host request flow.
3. Core `Agent` intercept ordering remains unchanged and synchronous.
4. Coordination sync operations are out-of-band and bounded by queue limits.
5. Coordination payloads are metadata-only. Raw payload bytes never leave Quarantine boundary.

### Integration Boundaries

1. Core consumes only this public contract and never imports provider-specific SDK code in hot path.
2. Adapter status mapping (`403`, `429`, `413`, fail-open semantics) is unchanged by this RFC.
3. Provider support is feature-negotiated via `features`; unsupported sync operations are no-op by contract.

## Security Considerations

1. Trust boundary: providers are external systems and must be treated as untrusted for integrity until verified.
2. Attack vector: stale synchronization can cause policy drift. Mitigation: explicit health mode and lag metrics.
3. Attack vector: coordination outage amplification. Mitigation: deterministic fallback to `local` mode.
4. Attack vector: metadata poisoning. Mitigation: strict input validation and bounded retry queues.
5. Fail-open behavior: provider failure must never force fail-closed behavior in host application traffic.

## Performance Impact

1. No additional work is added to intercept hot path.
2. Expected overhead is isolated to background synchronization tasks.
3. Queue memory is bounded and must enforce deterministic drop policy under pressure.
4. Health checks are constant-time snapshot reads.

## Backward Compatibility

1. No runtime breaking changes are introduced in this draft phase.
2. Integration is opt-in; existing deployments remain local-only by default.
3. No changes to current adapter response status mapping.
4. Migration path for future implementation: add provider config with default `disabled`.

## Test Plan

1. Unit:
2. `CoordinationHealth` mode transitions (`local` <-> `degraded` <-> `synchronized`).
3. Feature negotiation and no-op behavior for unsupported capabilities.
4. Queue bound enforcement under overflow.
5. Integration:
6. Core with provider unavailable at startup and at runtime.
7. Core with intermittent provider lag and recovery.
8. Scenario:
9. Multi-instance sync lag while maintaining host throughput.
10. Provider outage storm without host request interruption.
11. Security-negative:
12. Replay and stale-update injection against provider adapters.
13. Malformed metadata and oversized sync envelope rejection.

## Alternatives Considered

1. Direct Horizon SDK dependency in core.
2. Rejected because it violates external boundary and increases coupling risk.
3. Fail-closed coordination policy when provider is unavailable.
4. Rejected because it violates Tracehound fail-open principle and can create self-DoS behavior.
5. Implicit provider discovery through side-effect imports.
6. Rejected because it creates non-deterministic startup behavior and weak governance.
