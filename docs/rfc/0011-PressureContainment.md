# RFC-0011: Pressure Containment and Graceful Shielding

## Title and Metadata

| Field          | Value                  |
| -------------- | ---------------------- |
| RFC            | 0011                   |
| Status         | Implemented            |
| Author         | Tracehound Engineering |
| Created        | 2026-03-03             |
| Updated        | 2026-03-26             |
| Depends on     | RFC-0000, RFC-0010     |
| Supersedes     | None                   |
| Implemented in | `packages/core/src/core/pressure-controller.ts`, `packages/core/src/core/tracehound.ts`, `packages/core/src/core/quarantine.ts`, `packages/core/src/core/watcher.ts`, `packages/core/src/utils/system-snapshot.ts`, `packages/cli/src/commands/status.ts`, `packages/cli/src/commands/watch.ts` |

## Implementation Status

As of 2026-03-26, the OSS scope of this RFC is implemented.

Implemented OSS behaviors:

1. Core exports first-class `PressureMode` and `PressureState` types.
2. A deterministic pressure controller transitions runtime state between `normal`, `elevated`, and `critical` using bounded quarantine stats, archive-failure signals, and Hound pressure outcomes.
3. Pressure state is exposed through watcher snapshots, signed runtime snapshots, and CLI `status` / `watch` surfaces.
4. TTL decay continues under pressure, while `critical` mode suppresses optional decay-time archival.
5. Quarantine pressure accounts for both byte saturation and count saturation before hard-cap drops occur.
6. Acute overload visibility remains separate from sticky pressure state, so recovery can clear transient overload while cooldown still preserves `critical` pressure truth.

Explicit OSS non-goals:

1. No operator override API is exposed.
2. No pressure policy hook or control-plane callback surface is exposed.
3. AuditChain remains evidence-centric; pressure transitions are observable through snapshots and notifications, not separate audit records.

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
  readonly archiveSuppressed: boolean
  readonly updatedAt: number
  readonly signals: {
    quarantineBytes: number
    quarantineCount: number
    quarantineCapacityPercent: number
    droppedEvents: number
    archiveFailureCount: number
    houndPressureEvents: number
    overloaded: boolean
  }
}
```

OSS configuration surface:

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

### Drop and Count Policy

1. Under `critical` pressure, Tracehound stops optional decay-time archive forwarding.
2. New events beyond bounded limits are dropped deterministically and counted.
3. `droppedEvents` is monotonic and observable through metrics.
4. No unbounded retry loops are allowed while in `critical` pressure mode.

### Memory-First Buffering

1. Default buffering model is in-memory ring buffer with hard byte and count limits.
2. Disk-based write-ahead persistence is explicit opt-in only.
3. On overflow, oldest low-priority entries are evicted first per deterministic rules.
4. Pressure transitions are driven by the stronger of byte utilization and count utilization.

### Graceful Shielding

1. Oversized input handling targets graceful `413 Payload Too Large`.
2. Stream rejection paths should avoid aggressive socket reset semantics by default.
3. If graceful handling fails, fallback path must preserve host survivability and fail-open semantics.

### OSS Observation Surface

1. `th.watcher.snapshot()` exposes first-class pressure state.
2. `th.snapshot()` includes signed pressure state for CLI/runtime truth.
3. `th.notifications` emits `pressure.transition` and `pressure.archive_suppressed`.
4. OSS scope remains observation-oriented; no policy override or manual pressure control API is included.

## Security Considerations

1. Trust boundary: upstream request input is untrusted and can be adversarially oversized.
2. Attack vector: pressure-induced self-DoS by forcing expensive archive behavior.
3. Mitigation: deterministic Drop and Count, bounded background work, and critical-mode archival suppression.
4. Attack vector: retry amplification from abrupt connection resets.
5. Mitigation: graceful error signaling where possible and bounded handling paths.
6. Fail-open behavior: Tracehound overload must not hard-crash host process.
7. Data safety: counters and pressure telemetry remain metadata-only; no payload serialization.
8. OSS scope intentionally excludes operator control hooks so pressure logic cannot be bypassed at runtime.

## Performance Impact

1. Expected reduced p99 latency jitter under pressure due to bounded work shedding.
2. Constant-time counter updates for dropped events.
3. Bounded ring-buffer operations remain O(1) amortized for insertion/eviction.
4. Additional overhead from pressure tracking is minimal and predictable.

## Backward Compatibility

1. Pressure containment adds a new optional `pressure` config surface and new snapshot / notification fields.
2. Safe defaults are provided when `pressure` config is omitted.
3. Adapter status map remains unchanged.
4. Existing deployments gain additional observability and critical-mode archival suppression without introducing policy hooks or manual override APIs.

## Implementation Plan

1. Introduce canonical `PressureMode` and `PressureState` types in core and expose them through public type exports.
2. Add a bounded pressure controller that derives mode transitions from deterministic signals already present in the system.
3. Extend `Watcher`, `SystemSnapshot`, and CLI surfaces to expose pressure state explicitly instead of relying only on the `overloaded` boolean.
4. Gate optional archival forwarding on pressure mode so `critical` pressure suppresses non-essential archive work deterministically.
5. Add integration tests for mode transitions, sustained pressure recovery, count saturation, and cold-storage suppression while preserving fail-open host behavior.
6. Keep enterprise-oriented policy hooks, operator overrides, and operational audit expansion out of OSS scope.

## Test Plan

1. Unit: pressure mode transitions based on deterministic thresholds.
2. Unit: Drop and Count counter monotonicity and overflow safety.
3. Unit: count saturation raises pressure before hard-cap drop.
4. Integration: core pressure mode with Hound pressure recovery cooldown.
5. Integration: critical pressure suppresses decay-time archival without incrementing archive-failure counters.
6. Integration: adapter behavior for oversized requests producing `413`.
7. Scenario: burst traffic + slow sink + TTL storm with bounded memory verification.
8. Security-negative: resource exhaustion attempts with malformed and oversized Scent inputs.
9. Security-negative: retry amplification simulation under repeated oversized request floods.

## Alternatives Considered

1. Continue passive archiving during all pressure states.
2. Rejected because it can amplify CPU, IO, and network contention during attack conditions.
3. Use disk-first buffering by default.
4. Rejected because disk exhaustion can violate host survivability guarantees in constrained environments.
5. Hard socket destruction on oversized inputs.
6. Rejected because it increases retry amplification risk and operational instability.
