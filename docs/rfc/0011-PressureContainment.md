# RFC-0011: Pressure Containment and Graceful Shielding

## Title and Metadata

| Field          | Value                  |
| -------------- | ---------------------- |
| RFC            | 0011                   |
| Status         | Draft                  |
| Author         | Tracehound Engineering |
| Created        | 2026-03-03             |
| Updated        | 2026-03-03             |
| Depends on     | RFC-0000, RFC-0010     |
| Supersedes     | None                   |
| Implemented in | TBD                    |

## Motivation

Roadmap risk analyses identify a critical survivability gap under sustained pressure: archiving and stream-level rejection strategies can unintentionally amplify resource exhaustion and jeopardize host availability. Tracehound needs deterministic pressure containment that prioritizes host survivability over forensic completeness.

Problems addressed:

1. Potential unbounded pressure amplification during archive or sink degradation.
2. Unsafe oversized request handling patterns (for example abrupt socket destruction).
3. Lack of deterministic shedding policy linked to bounded memory constraints.

## Design

### Pressure Modes

```ts
type PressureMode = 'normal' | 'elevated' | 'critical'

interface PressureState {
  readonly mode: PressureMode
  readonly quarantineBytes: number
  readonly droppedEvents: number
  readonly updatedAt: number
}
```

### Drop and Count Policy

1. Under `critical` pressure, Tracehound stops optional archive forwarding.
2. New events beyond bounded limits are dropped deterministically and counted.
3. `droppedEvents` is monotonic and observable through metrics.
4. No unbounded retry loops are allowed while in `critical` pressure mode.

### Memory-First Buffering

1. Default buffering model is in-memory ring buffer with hard byte and count limits.
2. Disk-based write-ahead persistence is explicit opt-in only.
3. On overflow, oldest low-priority entries are evicted first per deterministic rules.

### Graceful Shielding

1. Oversized input handling targets graceful `413 Payload Too Large`.
2. Stream rejection paths should avoid aggressive socket reset semantics by default.
3. If graceful handling fails, fallback path must preserve host survivability and fail-open semantics.

## Security Considerations

1. Trust boundary: upstream request input is untrusted and can be adversarially oversized.
2. Attack vector: pressure-induced self-DoS by forcing expensive archive behavior.
3. Mitigation: deterministic Drop and Count and bounded background work.
4. Attack vector: retry amplification from abrupt connection resets.
5. Mitigation: graceful error signaling where possible and bounded handling paths.
6. Fail-open behavior: Tracehound overload must not hard-crash host process.
7. Data safety: counters and pressure telemetry remain metadata-only; no payload serialization.

## Performance Impact

1. Expected reduced p99 latency jitter under pressure due to bounded work shedding.
2. Constant-time counter updates for dropped events.
3. Bounded ring-buffer operations remain O(1) amortized for insertion/eviction.
4. Additional overhead from pressure tracking is minimal and predictable.

## Backward Compatibility

1. No runtime behavior changes are applied in this governance sprint.
2. Future pressure controls are expected to be additive behind configuration defaults.
3. Adapter status map remains unchanged.
4. Existing deployments can remain on current behavior until pressure controls are explicitly enabled.

## Test Plan

1. Unit:
2. Pressure mode transitions based on deterministic thresholds.
3. Drop and Count counter monotonicity and overflow safety.
4. Ring-buffer bound enforcement and eviction determinism.
5. Integration:
6. Core pressure mode with cold storage unavailable/degraded.
7. Adapter behavior for oversized requests producing `413`.
8. Scenario:
9. Burst traffic + slow sink + TTL storm with bounded memory verification.
10. Recovery path from `critical` to `normal` mode without host interruption.
11. Security-negative:
12. Resource exhaustion attempts with malformed and oversized Scent inputs.
13. Retry amplification simulation under repeated oversized request floods.

## Alternatives Considered

1. Continue passive archiving during all pressure states.
2. Rejected because it can amplify CPU, IO, and network contention during attack conditions.
3. Use disk-first buffering by default.
4. Rejected because disk exhaustion can violate host survivability guarantees in constrained environments.
5. Hard socket destruction on oversized inputs.
6. Rejected because it increases retry amplification risk and operational instability.
