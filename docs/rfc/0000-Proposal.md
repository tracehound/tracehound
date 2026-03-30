# RFC-0000: Tracehound – Core [Locked]

## Summary

Tracehound is a runtime-independent, deterministic **security buffer** inspired by an **immune system** model. It is designed for threat isolation, evidence preservation, and neutralization workflows.

**Not:**

- An APM / observability tool
- A logging framework
- A caching system

**Yes:**

- Threat quarantine buffer
- Evidence preservation layer
- Zero-tolerance security boundary

---

## Core Principles

| Principle            | Description                                    |
| -------------------- | ---------------------------------------------- |
| **Decision-free**    | Makes no policy, retry, or backoff decisions   |
| **Zero-tolerance**   | Every threat is isolated, with no exceptions   |
| **Deterministic**    | GC-independent with explicit lifecycle control |
| **Ownership-based**  | Memory is managed through explicit disposal    |
| **Sync hot-path**    | All critical operations stay synchronous       |
| **Defense-in-depth** | Each layer provides its own security guarantee |

---

## Architecture

```md
┌─────────────────────────────────────────────────────────────────┐
│ WATCHER │
│ ───────────────────────────────────────── │
│ Pull-based system monitor │
│ Gateway traffic, API responses, system events │
│ │
│ suspicious activity │
│ │ │
│ ▼ │
├─────────────────────────────────────────────────────────────────┤
│ RATE LIMITER │
│ ───────────────────────────────────────── │
│ Per-source request limiting │
│ Early rejection before AGENT │
│ │
│ within limits │
│ │ │
│ ▼ │
├─────────────────────────────────────────────────────────────────┤
│ AGENT │
│ ───────────────────────────────────────── │
│ intercept(request) → InterceptResult │
│ Sync, zero-allocation hot-path │
│ Content-based signature (collision-resistant) │
│ │
│ threat detected │
│ │ │
│ ▼ │
├─────────────────────────────────────────────────────────────────┤
│ QUARANTINE │
│ ───────────────────────────────────────── │
│ Map<ThreatSignature, EvidenceHandle> │
│ Ownership model: atomic neutralize │
│ Priority-based eviction │
│ gzip + binary encoded evidence │
│ │
│ neutralize() → atomic(snapshot + destroy) │
│ evacuate() → gzip + log → safe-zone │
│ │
│ threshold exceeded │
│ │ │
│ ▼ │
├─────────────────────────────────────────────────────────────────┤
│ HOUND POOL │
│ ───────────────────────────────────────── │
│ Pre-spawned sandboxed processes │
│ Read-only return channel │
│ Timeout + force-terminate │
│ Jittered rotation cycle │
│ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Detection Model

### Core Principle

**Tracehound does NOT perform threat detection.**

Detection belongs to an external layer. Tracehound only processes threat signals provided by that external layer.

### External Detection Sources

| Source        | Description                        |
| ------------- | ---------------------------------- |
| WAF           | Cloudflare, AWS WAF, ModSecurity   |
| Custom Rules  | Regex patterns, signature matching |
| ML Models     | Trained threat classifiers         |
| Rate Limiters | DDoS detection services            |
| SIEM          | Security event correlation         |

### Integration Pattern

```ts
// External detector (WAF, custom, ML)
const detector = createDetector({ rules, patterns, model })

// Tracehound = buffer only
const tracehound = createTracehound(config)

// Integration point
app.use((req, res, next) => {
  const result = detector.analyze(req)

  if (result.isThreat) {
    // External says "this is threat" → Tracehound quarantines
    tracehound.intercept({
      id: req.id,
      payload: req.body,
      source: req.ip,
      timestamp: Date.now(),
      threat: {
        category: result.category,
        severity: result.severity,
      },
    })
    return res.status(403).send('Blocked')
  }

  next()
})
```

### API Contract

`intercept()` can be called in two ways:

1. **Pre-classified threat** (external detection)

```ts
intercept({
  id,
  payload,
  source,
  timestamp,
  threat: { category: 'injection', severity: 'high' },
})
// → Quarantine
```

1. **Raw scent** (no threat signal)

```ts
intercept({ id, payload, source, timestamp })
// → { status: 'clean' }, NO quarantine
```

**No external threat signal = no quarantine.** Tracehound does not make decisions on its own.

---

## Component Definitions

### Scent

The request unit entering the Agent.

```ts
interface Scent {
  id: string // request identifier
  payload: unknown // request data (size-limited)
  source: {
    ip: string
    userAgent?: string
    tls?: {
      protocol?: string
      cipherSuite?: string
      alpn?: string
    }
  } // structured origin for rate limiting and forensic continuity
  timestamp: number // capture time
  threat?: {
    category: ThreatCategory
    severity: 'low' | 'medium' | 'high' | 'critical'
  }
}
```

**Constraint:** `sizeof(payload) <= config.maxPayloadSize`

### Threat

A malicious Scent identified by an external detector.

```ts
interface Threat {
  signature: string // content-based, collision-resistant
  category: ThreatCategory
  severity: 'low' | 'medium' | 'high' | 'critical'
  scent: Scent
}

type ThreatCategory = 'injection' | 'ddos' | 'flood' | 'spam' | 'malware' | 'unknown'
```

### Intent (Threat Signature)

Content-based, collision-resistant signature generation.

```ts
// Signature = category + content hash
// Different payload should produce a different signature (collision-resistant; collisions are computationally infeasible)
function generateSignature(threat: Threat): string {
  const contentHash = sha256(serialize(threat.scent.payload))
  return `${threat.category}:${contentHash}`
}
```

**Security:** Attacker cannot predict or collide signatures.

---

## Behavioral Rules

### Same Intent (Known Threat)

→ **IGNORE**. Evidence already exists in Quarantine.

### Same Intent, Different Payload

**Impossible.** Signature = content hash. A different payload produces a different signature by definition.

### New Intent (New Threat)

→ **ENCODE + QUARANTINE**
→ Existing intent is not flushed (security: preserve evidence)

---

## Security Layer: Rate Limiting

Early rejection before Agent processing.

```ts
interface RateLimiter {
  check(source: Scent['source']): RateLimitResult
  reset(source: Scent['source']): void
}

type RateLimitResult = { allowed: true } | { allowed: false; retryAfter: number; reason: string }

interface RateLimitConfig {
  windowMs: number // time window (default: 60_000)
  maxRequests: number // max per window (default: 100)
  blockDurationMs: number // block duration after limit (default: 300_000)
}
```

**Protection:** Pool exhaustion DoS prevented at gate.

---

## Memory Model: Atomic Ownership

GC-independent, deterministic, tamper-resistant memory management.

```ts
interface EvidenceHandle {
  readonly bytes: ArrayBuffer
  readonly size: number
  readonly hash: string
  readonly signature: string
  readonly captured: number
  readonly severity: 'low' | 'medium' | 'high' | 'critical'
  readonly disposed: boolean

  transfer(): ArrayBuffer
  neutralize(): NeutralizationRecord
  evacuate(): EvacuateRecord
}
```

### Atomic Neutralize

Snapshot → Destroy in single atomic operation. No tampering window.

```ts
function neutralize(): NeutralizationRecord {
  if (this.disposed) return null

  // ATOMIC: snapshot before destroy
  const record: NeutralizationRecord = {
    id: generateSecureId(),
    signature: this.signature,
    hash: this.hash,
    size: this.size,
    status: 'neutralized',
    timestamp: Date.now(),
    previousHash: auditChain.lastHash, // integrity chain
  }

  // Destroy immediately after snapshot
  this.bytes = null
  this.disposed = true

  // Update audit chain
  auditChain.append(record)

  return record
}
```

### Secure ID Generation

crypto.randomUUID + random suffix for unpredictability.

```ts
function generateSecureId(): string {
  const uuid = crypto.randomUUID()
  const randomSuffix = crypto.getRandomValues(new Uint8Array(4))
  return `${uuid}-${toHex(randomSuffix)}`
}
```

---

## Audit Trail Integrity

Cryptographic hash chain prevents evidence tampering.

```ts
interface AuditChain {
  readonly lastHash: string
  append(record: NeutralizationRecord | EvacuateRecord): void
  verify(): boolean
}

// Each record contains hash of previous record
// Tampering breaks the chain → detectable
```

---

## Quarantine Eviction Policy

Priority-based eviction when limits reached.

```ts
interface EvictionPolicy {
  // Eviction order (lowest priority first)
  // 1. severity: low → medium → high → critical
  // 2. age: oldest first within same severity

  selectForEviction(count: number): EvidenceHandle[]
}

// Eviction is NOT silent
function evict(handle: EvidenceHandle): void {
  // 1. Transfer to cold storage (if configured)
  if (config.coldStorage) {
    coldStorage.transfer(handle)
  }

  // 2. Log eviction
  log({
    type: 'quarantine.eviction',
    signature: handle.signature,
    severity: handle.severity,
    reason: 'capacity',
  })

  // 3. Alert if high/critical severity evicted
  if (handle.severity === 'high' || handle.severity === 'critical') {
    watcher.alert({
      severity: 'warning',
      type: 'high_severity_eviction',
      signature: handle.signature,
    })
  }

  // 4. neutralize
  handle.neutralize()
}
```

---

## Hound Isolation Model

### v1 (Required)

Hound MUST execute in a **separate OS process**.

| Guarantee                 | Description                                                                     |
| ------------------------- | ------------------------------------------------------------------------------- |
| Independent crash domain  | Hound crash does not affect Core                                                |
| OS-level memory isolation | No shared memory with Core                                                      |
| Process constraints       | Memory limit enforced where available; other denies are declarative/best-effort |
| Bounded pool              | No unbounded spawn                                                              |
| Binary IPC                | Length-prefixed protocol over stdio                                             |

### v2+ (Optional)

Hound MAY execute inside a **WASM sandbox**.

| Guarantee               | Description                  |
| ----------------------- | ---------------------------- |
| Deterministic execution | Same input → same output     |
| Memory-safe             | Linear memory only           |
| No syscalls             | Except explicitly allowed    |
| Same semantics          | Pool, IPC, timeout unchanged |

> WASM execution is an implementation detail and MUST NOT change Core or Pool semantics.

### Explicitly Rejected

The following isolation models are **permanently rejected**:

| Model                | Reason                                      |
| -------------------- | ------------------------------------------- |
| In-process execution | No isolation, violates security assumptions |
| Worker threads       | Shared process failure domain               |

---

## Hound Pool (Process-Based)

Bounded, isolated, timeout-protected **child processes** managed through a pool abstraction.

```ts
interface HoundPool {
  activate(evidence: Evidence): void
  terminate(signature: string): void
  readonly stats: HoundPoolStats
  onResult(handler: (result: HoundResult) => void): void
  shutdown(): void
}
```

### Strict Pool Semantics (REQUIRED)

Hound processes MUST be managed by a **bounded pool of process slots**.

```md
HoundPool
├─ process slots: N
├─ active: ≤ poolSize
└─ overflow handling: drop | escalate | defer
```

**Rules:**

- No process may be spawned outside pool admission
- `poolSize` is a **hard limit**
- Lazy spawn inside admitted slots is allowed
- Spawn outside pool is **forbidden**
- Deferred overflow MUST remain bounded

> Hound creation is **capacity-bound**, not demand-driven.

When pool is exhausted, Core MUST:

```ts
type PoolExhaustedAction = 'drop' | 'escalate' | 'defer'
```

Current runtime configuration also bounds deferred overflow explicitly:

```ts
interface HoundPoolConfig {
  poolSize: number
  timeout: number
  rotationJitterMs: number
  onPoolExhausted?: PoolExhaustedAction
  deferQueueLimit?: number
  processConstraints?: Partial<HoundProcessConstraints>
}
```

This prevents **spawn amplification** and unbounded queue growth.

### Binary IPC Protocol (REQUIRED)

Inter-process communication between Core and Hound MUST use a **length-prefixed binary protocol** over stdio pipes.

```md
[4 bytes length BE][N bytes payload]
```

**JSON encoding is explicitly forbidden.**

```ts
interface HoundIPC {
  encodeMessage(payload: ArrayBuffer): Buffer
  decodeHoundMessage(payload: ArrayBuffer): HoundMessage
  createMessageParser(): MessageParser
}
```

**Ordering guarantee:**

- Single request per hound at a time
- No concurrent in-flight messages
- FIFO by design

### Platform IPC Adapter

```ts
interface HoundProcessAdapter {
  spawn(script: string, constraints?: Partial<HoundProcessConstraints>): HoundHandle
  send(handle: HoundHandle, payload: ArrayBuffer): void
  kill(handle: HoundHandle): void
  onExit(handle: HoundHandle, cb: (code: number | null, signal: string | null) => void): void
  onMessage(handle: HoundHandle, cb: (payload: ArrayBuffer) => void): void
}
```

| Platform | Strategy                                  |
| -------- | ----------------------------------------- |
| Linux    | spawn + stdio pipes                       |
| macOS    | spawn + stdio pipes                       |
| Windows  | spawn + stdio pipes (no fork assumptions) |

> No fork-specific semantics are relied upon.
> Spawn + pipe is the portability baseline.

### Process Sandbox Constraints

```ts
interface HoundProcessConstraints {
  // Best-effort resource constraint
  maxMemoryMB?: number

  // Declarative denied capabilities
  networkAccess: false
  fileSystemWrite: false
  childSpawn: false
}
```

### Read-Only Return Channel

```ts
// Hound process can ONLY send bounded metadata messages
type HoundMessage =
  | { type: 'status'; state: 'processing' | 'complete' | 'error' }
  | { type: 'metrics'; processingTime: number; memoryUsed: number }
  | { type: 'analysis'; hash: string; entropy: number; contentType: string; sizeBytes: number }

// Hound process CANNOT send:
// - Raw payload bytes
// - Code
// - Commands to main process
```

### Processing Timeout

```ts
interface HoundPoolConfig {
  poolSize: number
  timeout: number
  rotationJitterMs: number
  onPoolExhausted?: PoolExhaustedAction
  deferQueueLimit?: number
}

// Force-kill stuck Hounds
function monitorHound(processState: ProcessState): void {
  const timeout = setTimeout(() => {
    if (processState.busy) {
      terminateProcess(processState, 'timeout')
    }
  }, config.timeout)
}

// The timeout is cleared when processing completes, errors, or the process is terminated.
```

### Rotation Jitter

`rotationJitterMs` is reserved in the current pool configuration as a rotation-jitter control surface.
The current OSS runtime does not implement active timed rotation yet, so no normative runtime guarantee depends on it today.

```ts
interface HoundPoolConfig {
  rotationJitterMs: number
}
```

---

## Watcher (Observer)

Pull-based system monitor with rate-limited alerts.

```ts
interface Watcher {
  snapshot(): WatcherSnapshot
  alert(alert: Alert): void
}

interface WatcherSnapshot {
  quarantine: {
    count: number
    bytes: number
    bySeverity: Record<string, number>
  }
  hound: {
    dormant: number
    active: number
    terminated: number // count of force-terminated
  }
  rateLimit: {
    blocked: number
    sources: number
  }
  throughput: number
  lastActivity: number
  errors: TracehoundError[]
}
```

### Alert Rate Limiting

Prevent alert fatigue attacks.

```ts
interface AlertConfig {
  maxAlertsPerWindow: number // default: 10
  windowMs: number // default: 60_000
  escalationThreshold: number // alerts before escalation
}

function alert(alert: Alert): void {
  if (alertCount >= config.maxAlertsPerWindow) {
    // Escalate instead of flood
    if (!escalated) {
      escalate({
        type: 'alert.flood',
        message: 'Alert threshold exceeded',
        alertCount: alertCount,
      })
      escalated = true
    }
    return
  }

  // Normal alert
  emit(alert)
  alertCount++
}
```

---

## Error Handling

No crash. Error propagate edilir, sistem devam eder.

```ts
interface TracehoundError {
  state: 'quarantine' | 'hound' | 'agent' | 'scheduler' | 'ratelimit'
  code: string
  message: string
  context?: unknown
  recoverable: boolean
}
```

**Kurallar:**

- Each state owns its own error management
- Error → log + state-specific recovery
- Hound error → terminate + replenish
- Quarantine error → alert + continue
- Non-recoverable error → graceful degradation, not crash

---

## API

```ts
interface Tracehound {
  // Lifecycle
  init(): Promise<void>
  dispose(): void

  // Core
  intercept(scent: Scent): InterceptResult
  neutralize(signature: string): NeutralizationRecord | null
  evacuate(signature: string): EvacuateRecord | null
  flush(): NeutralizationRecord[]

  // Monitoring
  readonly watcher: Watcher
  readonly quarantine: QuarantineStats
  readonly auditChain: AuditChain
}

type InterceptResult =
  | { status: 'clean' }
  | { status: 'rate_limited'; retryAfter: number }
  | { status: 'payload_too_large'; limit: number }
  | { status: 'ignored'; signature: string }
  | { status: 'quarantined'; handle: EvidenceHandle }
  | { status: 'escalated'; hound: Hound }
  | { status: 'error'; error: TracehoundError }
```

---

## Configuration

```ts
interface TracehoundConfig {
  // Input validation
  maxPayloadSize: number // max scent payload (default: 1_000_000)

  // Rate limiting
  rateLimit: {
    windowMs: number
    maxRequests: number
    blockDurationMs: number
  }

  // Quarantine
  quarantine: {
    maxCount: number
    maxBytes: number
    evictionPolicy: 'lru' | 'priority' // default: priority
  }

  // Hound Pool
  hound: {
    minimumDormant: number
    maxActive: number
    maxLifeTimeCycle: number
    maxProcessingTime: number // timeout
    replenishDelay: number
  }

  // Scheduler
  scheduler: {
    rotationInterval: number
    jitterMax: number // timing attack prevention
    skipIfBusy: boolean
  }

  // Alerts
  alerts: {
    maxAlertsPerWindow: number
    windowMs: number
    escalationThreshold: number
    devopsEndpoint?: string
  }

  // Audit
  audit: {
    chainEnabled: boolean // integrity chain
    coldStorage?: ColdStorageConfig
  }
}
```

---

## Security Checklist

| Threat                  | Mitigation                        | Status |
| ----------------------- | --------------------------------- | ------ |
| Evidence tampering      | Atomic neutralize                 | ✅     |
| Signature collision     | Content-based hash                | ✅     |
| Process escape          | OS isolation + read-only IPC      | ✅     |
| Pool exhaustion DoS     | Rate limiting + timeout           | ✅     |
| Memory exhaustion       | Priority eviction + alerts        | ✅     |
| ID predictability       | crypto.randomUUID + random suffix | ✅     |
| Scheduler timing attack | Jittered rotation                 | ✅     |
| Payload overflow        | maxPayloadSize                    | ✅     |
| Alert fatigue           | Rate-limited alerts               | ✅     |
| Audit trail tampering   | Cryptographic hash chain          | ✅     |

---

## Threat Model

### Trust Boundaries

```md
                    ┌───────────────────────────┐
                    │     UNTRUSTED ZONE        │
                    │  External HTTP Requests   │
                    │  Scent Payload          │
                    │  Hound Output               │
                    └─────────────┬─────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │     TRUST BOUNDARY        │
                    │  Rate Limiter + Validator │
                    └─────────────┬─────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │     TRUSTED CORE          │
                    │  Agent → Quarantine      │
                    └─────────────┬─────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │   ISOLATION BOUNDARY      │
                    │  Hound Processes (sandbox) │
                    └───────────────────────────┘
```

### Tracehound Trusts

| Element           | Reason                                 |
| ----------------- | -------------------------------------- |
| Operating System  | Process isolation, file system         |
| Node.js Runtime   | V8, libuv, core modules (CVE-free LTS) |
| Configuration     | Loaded from trusted source (env vars)  |
| External Detector | WAF/detector threat signals            |

### Tracehound Does NOT Trust

| Element               | Mitigation                                       |
| --------------------- | ------------------------------------------------ |
| Scent Payload         | Size limit, schema validation, rate limit        |
| Hound Output          | Read-only IPC, status reports only               |
| Cold Storage Response | Fire-and-forget, no read-back                    |
| Network Input         | External concern, we don't accept direct network |

### Threat Categories

| Category     | Threat               | CWE      | Mitigation                           |
| ------------ | -------------------- | -------- | ------------------------------------ |
| Input        | Payload overflow     | CWE-400  | maxPayloadSize                       |
| Input        | Prototype pollution  | CWE-1321 | Object.create(null), --disable-proto |
| Input        | ReDoS                | CWE-1333 | External detection, escape hatch     |
| DoS          | Pool exhaustion      | CWE-400  | Rate limiting, timeout               |
| DoS          | Memory exhaustion    | CWE-770  | Byte limits, priority eviction       |
| Timing       | Hash timing attack   | CWE-208  | timingSafeEqual                      |
| Isolation    | Process escape       | CWE-284  | OS isolation, read-only IPC          |
| Integrity    | Evidence tampering   | CWE-494  | Atomic neutralize, hash chain        |
| Supply Chain | Malicious dependency | CWE-1357 | Minimal deps, lockfile, audit        |

---

## Fail-Safe Mechanisms

### Purge + Replace Model

Timeout veya error durumunda process'i block etmeden controlled destruction:

```ts
// 1. IMMEDIATELY spawn replacement (sync, fast)
// 2. Transfer pending work to replacement
// 3. Queue old hound for background Purge
// 4. Continue with replacement - zero downtime

interface PurgeRecord {
  id: string
  reason: 'timeout' | 'error' | 'abort' | 'panic'
  scent: {
    id: string
    source: Scent['source']
    timestamp: number
    payloadHash: string // hash only, not full payload
    payloadSize: number
  }
  PurgeTimestamp: number
}
```

**Behavior:**

- Main thread NEVER waits for Purge completion
- Evidence preserved in cold storage (hash + metadata)
- Memory cleaned asynchronously
- Alert emitted

### Fail-Safe Actions

```ts
type FailSafeAction =
  | 'Purge' // destroy with evidence
  | 'quarantine' // normal flow
  | 'escalate' // alert, continue degraded
  | 'panic' // graceful shutdown

interface FailSafeConfig {
  onTimeout: FailSafeAction // default: 'Purge'
  onEncodeError: FailSafeAction // default: 'Purge'
  onQuarantineFull: FailSafeAction // default: 'Purge'
  onHoundError: FailSafeAction // default: 'escalate'
  onSystemError: FailSafeAction // default: 'panic'
}
```

### Panic Threshold

```ts
interface PanicConfig {
  threshold: {
    min: number // default: 3
    max: number // default: 10
    window: number // default: 60_000 ms
  }

  // Developer escape hatch
  onPanicThreshold?: (ctx: PanicContext) => PanicAction
}

type PanicAction = 'panic' | 'reset' | 'escalate' | 'custom'
```

### Developer Callbacks

```ts
interface FailSafeCallbacks {
  onPurge?: (record: PurgeRecord) => void
  onEscalate?: (alert: Alert) => void
  onPanicThreshold?: (ctx: PanicContext) => PanicAction
  onQuarantineFull?: (stats: QuarantineStats) => EvictionStrategy
  onColdStorageFailure?: (error: Error) => 'retry' | 'ignore' | 'alert'
}
```

### Safety Guarantees

| Guarantee          | Status                      |
| ------------------ | --------------------------- |
| Evidence preserved | Always (cold or quarantine) |
| Memory cleaned     | Guaranteed                  |
| Alert on failure   | Always                      |
| No crash           | Graceful degradation        |
| Developer override | Configurable                |

---

## Queue Strategy

### Lane-Based Priority Queue

```ts
// Each lane = FIFO within itself
// Lanes = Priority across

interface LaneQueue {
  critical: T[] // Process first
  high: T[]
  medium: T[]
  low: T[] // Process when idle
}
```

### Queue Assignments

| Queue            | Strategy           | Reasoning                   |
| ---------------- | ------------------ | --------------------------- |
| Purge            | FIFO               | Chronological for forensics |
| Alert            | Lane-based         | Critical alerts first       |
| Hound Activation | FIFO               | Fair, no starvation         |
| Cold Storage     | FIFO               | Audit trail order           |
| Eviction         | Priority (reverse) | Low severity first          |

---

## Cold Storage

### Definition

One-way, write-only wasteland.

```ts
interface ColdStorageConfig {
  type: 'url'
  endpoint: string // e.g., "s3://bucket/path"

  // Enforced constraints
  writeOnly: true
  appendOnly: true

  // Not our concern
  retentionPolicy?: never
  encryption?: never
}
```

**Trust model:** Fire-and-forget. Operators provide a URL, Tracehound performs POST/PUT, and no response payload is trusted.

---

## Runtime Flags

### Required Flags

```bash
node \
  --disable-proto=throw \
  --frozen-intrinsics \
  --max-old-space-size=512 \
  app.js
```

### Configuration

```ts
interface RuntimeFlags {
  disableProto: 'throw' | 'delete' // default: 'throw'
  frozenIntrinsics: boolean // default: true
  maxOldSpaceSize: number // default: 512 MB
  secureHeap?: number // optional, Linux only
}
```

---

## Trust Boundary Config

Developer defines trust levels:

```ts
interface TrustBoundaryConfig {
  cluster: {
    sharedState: 'redis' | 'memory' | 'none'
    trustLevel: 'trusted' | 'untrusted' // default: 'untrusted'
  }

  coldStorage: {
    endpoint: string
    trustLevel: 'write-only' | 'untrusted' // default: 'write-only'
  }

  detector: {
    source: 'external' | 'internal'
    trustLevel: 'trusted' | 'verify' // default: 'trusted'
  }
}
```

**Philosophy:** Tracehound provides the defaults; the developer defines the trust boundaries.

---

## Implementation Order

1. Core types + interfaces
2. Secure ID generation (crypto.randomUUID + suffix)
3. Rate limiter
4. EvidenceHandle (atomic ownership)
5. Audit chain
6. Quarantine (priority eviction)
7. Binary codec (gzip + hash)
8. Hound Pool (sandbox + timeout)
9. Tick scheduler (jitter)
10. Agent (signature generation)
11. Watcher (rate-limited alerts)
12. Integration + security tests

---

## Non-Goals

- Become a logging framework
- Become a metrics backend
- An alerting engine (notification only, rate-limited)
- WAF / Firewall replacement
- ML-based detection (external concern)

---

## Open Questions

- Compression algorithm selection (gzip vs brotli)
- Cold storage integration spec
- Multi-instance coordination
- External rate limiting integration (Redis, etc.)

---

## Implementation Notes (Phase 3 Addendum)

### Encoding Authority Invariant

**EvidenceFactory MUST remain the sole encoding authority.**

```
Agent → EvidenceFactory.create() → encode → compress → hash
       ↑ Agent NEVER touches encoding/compression directly
```

When adding codec (Step 7):

- Compression layer added INSIDE Factory
- Agent interface remains unchanged
- Factory options may include compression config

**Violation of this invariant breaks Phase 3 security guarantees.**

### Codec → Hound Pool Dependency

Implementation order MUST be:

1. Binary codec (Step 7)
2. Hound Pool (Step 8)

Reason: Child processes need final binary format. Implementing Hound Pool before codec requires interface changes later.

### Integration Test Coverage

Before Phase 5, full flow must be tested:

- Quarantine eviction during active intercept
- Concurrent intercept from multiple sources
- Memory pressure scenarios
- Rate limiter cleanup timing

---

**Status: LOCKED**

This RFC is intentionally narrow and security-hardened. Expansion should happen only after production use and security audit.
