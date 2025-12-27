# RFC-0001: Observable In-Memory Core State (Working Memory)

## Metadata

| Field            | Value                      |
| ---------------- | -------------------------- |
| Status           | Accepted (with conditions) |
| Security Impact  | Low (non-authoritative)    |
| Operational Risk | Medium (misconfiguration)  |
| Author           | -                          |
| Created          | 2024-12-23                 |

---

## Motivation

Core sistem genelinde **Map tabanlı, dağınık, gözlemlenemeyen** kısa ömürlü state kullanımı vardır. Bu durum:

- Determinism kaybına
- Memory pressure'ın görünmez olmasına
- Enterprise düzeyinde analiz ve tuning imkânsızlığına

neden olmaktadır.

Bu RFC, **karar verici olmayan**, **güvenlik otoritesi olmayan**, ancak:

- Observable
- Analyzable
- Measurable
- Configurable

bir **in-memory working state substrate** tanımlar.

Bu yapı **telemetry sistemi değildir**; core state'in **gözlemlenebilir ve sınırlandırılmış** hâlidir.

---

## Non-Goals

- Decision engine olmak
- Policy uygulamak
- Quarantine / Evidence ownership almak
- Persistence sağlamak
- Distributed consensus sağlamak

---

## High-Level Concept

```
Core Components
   │
   │ (mutate local state)
   ▼
Working Memory
   │
   ├── emit stateful events (append-only)
   └── expose readonly snapshots
```

Working Memory:

- **Authoritative değildir**
- **Best-effort** çalışır
- Crash / flush durumunda core davranışı bozulmaz

---

## Relationship with Watcher

| Component      | Role                                     |
| -------------- | ---------------------------------------- |
| Working Memory | State substrate (stores ephemeral state) |
| Watcher        | Observer (reads, aggregates, alerts)     |

**Tek yönlü ilişki:**

```
Working Memory ──► Watcher
```

**Kurallar:**

- Watcher **WM'ye yazamaz**
- WM Watcher'ı **tanımaz**
- Watcher snapshot okur + event dinler

> Watcher, Working Memory'nin consumer'ıdır.
> Working Memory, Watcher'dan habersizdir.

---

## Core Guarantees

| Guarantee                    | Status         |
| ---------------------------- | -------------- |
| Bounded memory               | ✅             |
| Deterministic eviction       | ✅             |
| No async in hot-path         | ✅             |
| Readonly external access     | ✅             |
| Flush without stop-the-world | ✅             |
| GC-independent semantics     | ✅ (see below) |

### GC Semantics

> Working Memory is **GC-independent by policy**, not by mechanism.
>
> - WeakRef **KULLANILMAZ** (non-deterministic)
> - Manual eviction, TTL ve flush ana mekanizmalardır
> - GC sadece reclaimed memory'yi hızlandırır
> - Hiçbir correctness GC'ye bağlı değildir

---

### Concurrency Model

Working Memory operates in a single-threaded execution context per Tracehound instance.

- No locks
- No atomics
- No shared memory across instances

This is a deliberate design choice to preserve determinism, bounded memory guarantees, and predictable failure behavior under attack.

Cross-instance correlation is explicitly out of scope and delegated to Argos or external collectors.

---

## Type Definitions

### Working Memory Interface

```ts
interface WorkingMemory<K, V> {
  get(key: K): V | undefined
  set(key: K, value: V, options?: EntryOptions): void
  delete(key: K): void
  clear(): void

  // Snapshot API (various granularity)
  snapshot(): ReadonlySnapshot<K, V> // heavy, dashboard only
  snapshotKeys(): ReadonlyArray<K> // lightweight
  entries(): IterableIterator<SnapshotEntry<K, V>> // lazy, O(1) alloc

  flush(reason: FlushReason): void
  stats(): MemoryStats
}
```

> **Warning:** `snapshot()` yalnızca dashboard / diagnostics için kullanılmalıdır.
> Hot-path'te kullanımı **unsupported** kabul edilir.

### Entry Options

```ts
interface EntryOptions {
  ttlMs?: number
  weight?: number
  priority?: 'low' | 'normal' | 'high' // default: 'normal'
  tags?: readonly string[]
}
```

### Snapshot Types

```ts
interface ReadonlySnapshot<K, V> {
  readonly size: number
  readonly totalWeight: number
  readonly entries: ReadonlyArray<SnapshotEntry<K, V>>
}

interface SnapshotEntry<K, V> {
  readonly key: K
  readonly value: V
  readonly expiresAt: number | null
  readonly priority: 'low' | 'normal' | 'high'
}
```

### Stats

```ts
interface MemoryStats {
  entries: number
  totalWeight: number
  evictions: number
  expired: number
  flushes: number
  hits: number
  misses: number
}
```

---

## Event Model

### Principles

- Events are **descriptive**, not authoritative
- Events never carry full state
- Events are append-only

### Event Configuration

```ts
interface WorkingMemoryConfig {
  maxEntries: number
  maxWeight: number
  defaultTTL: number
  flushThreshold: number
  eventKeyMode?: 'hash' | 'plain' | 'both' // default: 'hash'
  onEvent?: (event: WorkingMemoryEvent) => void // sync, non-blocking
}
```

**Event emission rules:**

- `onEvent` sync çağrılır
- Exception swallow edilir
- Core akışı **asla** etkilenmez

> Event emission is best-effort and non-authoritative.

### Event Types

```ts
type WorkingMemoryEvent =
  | { type: 'wm.insert'; keyHash: string; key?: string; weight: number }
  | { type: 'wm.expire'; keyHash: string; key?: string }
  | { type: 'wm.evict'; keyHash: string; key?: string; reason: 'capacity' | 'weight' }
  | { type: 'wm.flush'; reason: FlushReason }

type FlushReason = 'memory_pressure' | 'panic' | 'manual'
```

**Key mode behavior:**

| Mode               | `keyHash` | `key` |
| ------------------ | --------- | ----- |
| `'hash'` (default) | ✅        | ❌    |
| `'plain'`          | ❌        | ✅    |
| `'both'`           | ✅        | ✅    |

---

## Flush Semantics

> **Flush ≠ clear()**
> Flush = **priority-aware degradation**

| Reason            | Behaviour                  |
| ----------------- | -------------------------- |
| `memory_pressure` | Drop `low` → then `normal` |
| `panic`           | Drop all except `high`     |
| `manual`          | Configurable policy        |

---

## Behavioural Analysis

### Ideal Case

- Moderate traffic
- TTL expiry dominates eviction
- High cache hit rate
- Minimal GC churn

### Worst Case: Distributed Unique Payload Flood

| Aspect       | Behaviour |
| ------------ | --------- |
| Memory       | Bounded   |
| Eviction     | Constant  |
| CPU          | Elevated  |
| Accuracy     | Degraded  |
| Availability | Preserved |

Working Memory intentionally sacrifices **context retention** to preserve **liveness**.

### Worst Case: Hound Lock / Pool Starvation

Working Memory impact:

- Tracks short-term activation spikes
- Emits correlation events
- Does **not** block core flow

Flush may occur, but:

- Hound lifecycle unaffected
- Quarantine untouched

---

## Failure Modes

| Failure           | Result                 |
| ----------------- | ---------------------- |
| WM crash          | Core continues         |
| WM flush storm    | Metrics reset          |
| Collector failure | No impact              |
| Misconfiguration  | Alert + bounded damage |

---

## Security Considerations

- WM state is **non-authoritative**
- No evidence data stored
- No decision taken based on WM presence
- Snapshot is readonly

---

## Migration Strategy

1. Replace Map-based RateLimiter state
2. Instrument eviction & flush events
3. Expose readonly snapshots to dashboard
4. Gradually deprecate ad-hoc Maps

---

## Implementation Notes

### O(1) Guarantees

Implementation MUST use:

- `Map<K, Node>` for O(1) lookup
- Doubly-linked list for O(1) eviction
- Lazy TTL check on access + periodic sweep

### Invariants

1. O(1) get / set / evict
2. Eviction policy koddan ayrıdır
3. Lazy TTL + periodic sweep
4. Memory pressure weight ile kontrol edilir
5. No async inside WM

---

## Final Notes

- This RFC defines **infrastructure**, not intelligence
- It increases **explainability**, not autonomy
- It is designed to **degrade gracefully**, not to win every attack

> _Correctness is secondary to survivability._
