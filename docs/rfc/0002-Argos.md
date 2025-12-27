# RFC-0002: argos & Behavioral Signal Protocol

## Metadata

| Field            | Value                                     |
| ---------------- | ----------------------------------------- |
| Status           | Draft                                     |
| Security Impact  | Medium (new trust boundary)               |
| Operational Risk | Medium (sampling overhead)                |
| Dependencies     | RFC-0000 (Core), RFC-0001 (WorkingMemory) |
| Author           | -                                         |
| Created          | 2024-12-23                                |

---

## Motivation

RFC-0000 defines Tracehound as a **request-biased inbound security layer**. However, Node.js runtime exhibits threat-relevant behaviors **outside the request lifecycle**:

- Event loop starvation
- Child process anomalies
- Worker thread anomalies
- Runtime integrity violations
- Internal communication pattern drift

These signals are invisible to the existing architecture.

This RFC introduces **tracehound-argos**: a **non-authoritative, observation-only** layer that produces **behavioral signals** for external consumption.

> argos does not detect threats. argos produces signals that MAY be consumed by external detectors.

---

## Non-Goals

- Replace RFC-0000 threat model
- Perform threat detection
- Make decisions or block operations
- Observe kernel, syscalls, or native addon internals
- Monitor container orchestration or CI/CD pipelines
- Provide persistence or distributed consensus

---

## Relationship with Core Architecture

### RFC-0000 (Core)

argos is **downstream** of external detectors, not upstream of Tracehound:

```
tracehound-argos
       │
       │ (BehavioralSignal)
       ▼
External Detector / Policy Engine
       │
       │ (Threat)
       ▼
tracehound-core (RFC-0000)
```

**Critical invariant:** argos signals NEVER enter Tracehound directly.

### RFC-0001 (WorkingMemory)

argos MAY use WorkingMemory for ephemeral state aggregation.

**Constraints:**

- argos MUST use a separate WorkingMemory namespace
- argos MUST NOT define its own state substrate
- argos state MUST have short TTL (default: 60s)
- argos MUST only store aggregate/counter data, not evidence

```
WorkingMemory
 ├─ core (tracehound evidence metadata)
 └─ argos (behavioral aggregates)
```

---

## Trust Model

### Trust Boundary Extension

RFC-0000 defines trust levels for external detectors. This RFC extends the model:

```ts
interface TrustBoundaryConfig {
  // ... existing RFC-0000 fields ...

  argos: {
    source: 'internal'
    trustLevel: 'verify' // NEVER 'trusted'
  }
}
```

### Why argos is NOT Trusted

| Concern                      | Implication                             |
| ---------------------------- | --------------------------------------- |
| Runs inside target runtime   | Compromise affects signal integrity     |
| Sampling-based               | Non-deterministic by design             |
| No cryptographic attestation | Signals can be spoofed if runtime owned |

**Mandatory rule:** External detectors MUST cross-validate argos signals before threat escalation.

---

## Type Definitions

### BehavioralSignal

argos's sole output type. Explicitly distinct from RFC-0000 `Threat`.

```ts
interface BehavioralSignal {
  /** Fixed identifier for signal source */
  source: 'argos'

  /** Observation axis */
  axis: argosAxis

  /** Signal kind (namespaced, free-form) */
  kind: string

  /** Confidence in signal accuracy */
  confidence: 'low' | 'medium' | 'high'

  /** Sampling rate at capture time (0.0–1.0) */
  sampleRate: number

  /** Capture timestamp (epoch ms) */
  timestamp: number

  /** Optional structured metadata */
  metadata?: Record<string, number | string | boolean>
}

type argosAxis =
  | 'runtime' // Node.js version, flags, intrinsics
  | 'eventloop' // Latency, starvation, microtask queue
  | 'worker' // Thread pool behavior
  | 'integrity' // Frozen intrinsics, prototype chain
  | 'internal' // Internal HTTP/RPC patterns
```

### Why NOT Threat?

| Property          | Threat (RFC-0000)  | BehavioralSignal |
| ----------------- | ------------------ | ---------------- |
| Payload           | Present            | Absent           |
| Signature         | Content-based hash | None             |
| Determinism       | Guaranteed         | Best-effort      |
| Quarantine        | Yes                | No               |
| Request lifecycle | Bound              | Unbound          |

Mixing these types would corrupt the RFC-0000 model.

---

## Signal Transport

### Interface

```ts
interface SignalSink {
  /**
   * Emit a behavioral signal.
   *
   * - MUST be synchronous
   * - MUST NOT throw
   * - MUST NOT block the caller
   * - MUST NOT perform retries
   * - MUST NOT await external resources
   * - Return value ignored
   * - Exceptions MUST be swallowed silently
   */
  emit(signal: BehavioralSignal): void
}
```

### Transport Semantics (Normative)

| Property       | Value            |
| -------------- | ---------------- |
| Ordering       | Best-effort      |
| Delivery       | At-most-once     |
| Loss tolerance | Acceptable       |
| Retry          | None             |
| Backpressure   | Drop on overflow |

> argos MUST NOT depend on any specific signal transport.
> Signal transport MUST be replaceable without affecting argos semantics.
> Consumers MUST treat each BehavioralSignal as independent, even if delivered in batches.

### Transport Examples (Non-Normative)

| Environment    | Suggested Transport            |
| -------------- | ------------------------------ |
| Single process | In-memory adapter              |
| Multi-process  | IPC (Unix socket / named pipe) |
| Sidecar        | UDP / local socket             |
| Cloud          | External collector endpoint    |

---

## Observation Axes

### 3.1 Runtime Integrity

**Observes:**

- Node.js version / binary changes
- Frozen intrinsics integrity (`Object.freeze` check)
- Critical global object mutations
- Runtime flag anomalies (`--inspect`, `--allow-natives-syntax`)

**Implementation:** Periodic snapshot comparison.

### 3.2 Event Loop & Child Process Behavior

**Observes:**

- Event loop latency drift
- Microtask queue starvation
- Child Process spawn / termination patterns
- Thread pool exhaustion indicators

**Implementation:**

> argos MAY observe event loop latency using platform-provided instrumentation primitives.
> argos MUST NOT depend on specific Node.js API names or versions.

**Constraints:** See [Sampling & Overhead SLA](#sampling--overhead-sla).

### 3.3 Internal Communication Patterns

**Observes:**

- Internal HTTP/RPC request volume changes
- Header shape drift (structure, not content)
- Cardinality anomalies (unique endpoints, status codes)

**Constraints:**

- No payload inspection
- No request/response body access
- Aggregate metrics only

---

## Scope Exclusions (Explicit)

The following are **permanently out of scope** for RFC-0002:

| Exclusion              | Reason                                  |
| ---------------------- | --------------------------------------- |
| Container lifecycle    | Requires external API (kubelet, Docker) |
| Image digest changes   | Not accessible from Node.js runtime     |
| CI/CD pipeline events  | Post-runtime concern                    |
| Kernel memory          | OS-level, requires privileged access    |
| Syscall tracing        | eBPF / strace territory                 |
| Native addon internals | Opaque to V8                            |
| Process memory dumps   | Security risk, not observation          |

> These MAY be addressed in future "Extended argos" or sidecar projects.
> They are NOT part of tracehound-argos v1.

---

## Sampling & Overhead SLA

### Rule 1 — Sampling Only

```
argos MUST NOT perform continuous observation.
argos MUST use periodic, jittered sampling.
```

### Rule 2 — Budgeted Overhead

| Metric          | Maximum                                |
| --------------- | -------------------------------------- |
| CPU overhead    | < 1%                                   |
| Memory overhead | Bounded (configurable, default: 10MB)  |
| Allocation rate | Minimal (reuse buffers where possible) |

### Rule 3 — Zero Hot-Path Coupling

```
argos MUST NOT share primitives with request lifecycle.
argos MUST NOT hook userland HTTP clients.
argos MUST NOT inject async instrumentation.
```

### Configuration

```ts
interface argosConfig {
  /** Sampling interval (ms). Default: 5000 */
  sampleIntervalMs: number

  /** Jitter range (ms). Default: 1000 */
  jitterMaxMs: number

  /** Memory budget (bytes). Default: 10 * 1024 * 1024 */
  memoryBudget: number

  /** Signal sink implementation */
  sink: SignalSink

  /** WorkingMemory namespace. Default: 'argos' */
  wmNamespace?: string

  /** Axes to observe. Default: all */
  axes?: argosAxis[]
}
```

---

## argos Threat Surface

argos introduces its own attack surface. Mitigations are mandatory.

### Threat: Signal Injection (Fake Anomaly Flood)

**Attack:** Adversary floods external detector with false signals.

**Mitigation:**

```ts
interface SignalRateLimitConfig {
  maxSignalsPerWindow: number // default: 100
  windowMs: number // default: 60_000
}
```

Signals exceeding rate limit are dropped silently.

### Threat: Sampling Abuse

**Attack:** Adversary triggers high-frequency events to exhaust sampling budget.

**Mitigation:**

- Fixed sampling rate, not event-driven
- Jittered intervals prevent timing attacks

### Threat: Clock Skew Manipulation

**Attack:** System clock manipulation to confuse signal correlation.

**Mitigation:**

- Signals include `timestamp` but MUST NOT be used for ordering
- External detector SHOULD use receive-time, not signal-time

### Threat: Confidence Inflation

**Attack:** Adversary manipulates runtime to produce high-confidence false signals.

**Mitigation:**

- `confidence` is advisory only
- External detector MUST apply independent verification
- `trustLevel: 'verify'` enforces cross-validation

---

## API

```ts
interface argos {
  /** Start observation */
  start(): void

  /** Stop observation */
  stop(): void

  /** Current state (readonly) */
  readonly state: 'idle' | 'running' | 'stopped'

  /** Configuration (readonly) */
  readonly config: Readonly<argosConfig>
}

function createargos(config: argosConfig): argos
```

---

## Implementation Notes

### Observation Priority

When CPU budget constrains observation, priority order:

1. `integrity` (security-critical)
2. `runtime` (foundational)
3. `eventloop` (performance-critical)
4. `worker` (resource management)
5. `internal` (pattern analysis)

### WorkingMemory Usage

> argos WorkingMemory entries MUST be short-lived and prioritise recency over completeness.
> Historical accuracy is not required; trend and drift detection are the primary concerns.

```ts
// argos namespace in WorkingMemory
const wmConfig: WorkingMemoryConfig = {
  maxEntries: 1000,
  maxWeight: 10 * 1024 * 1024,
  defaultTTL: 60_000, // Ephemeral by design
  eventKeyMode: 'hash',
}
```

### Startup Sequence

1. Validate configuration
2. Initialize WorkingMemory namespace
3. Register signal sink
4. Begin sampling loop
5. Emit initial `runtime` snapshot

---

## Security Checklist

| Threat                 | Mitigation                     | Status |
| ---------------------- | ------------------------------ | ------ |
| Signal injection flood | Rate limiting                  | ✅     |
| Sampling exhaustion    | Fixed rate, jittered           | ✅     |
| Clock manipulation     | Receive-time correlation       | ✅     |
| Trust escalation       | `trustLevel: 'verify'`         | ✅     |
| Hot-path interference  | Zero coupling rule             | ✅     |
| Memory exhaustion      | Bounded budget                 | ✅     |
| Confidence abuse       | External verification required | ✅     |

---

## Open Questions

- Reference implementation API selection (platform-specific, non-normative)
- argos namespace eviction tuning based on production telemetry

---

**Status: DRAFT**

Pending review and approval before implementation.
