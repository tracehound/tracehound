# Performance SLA Specification

> **Version:** 1.0
> **Status:** Normative
> **Applies to:** @tracehound/core v1.0.0+

---

## Overview

This document specifies latency guarantees and performance characteristics for Tracehound core operations.

---

## Latency Guarantees

### Agent.intercept()

| Percentile | Target  | Condition             |
| ---------- | ------- | --------------------- |
| p50        | < 0.5ms | Normal operation      |
| p99        | < 2ms   | Normal operation      |
| p99.9      | < 10ms  | Under memory pressure |

**Notes:**

- Does NOT include HoundPool processing time (async)
- Does NOT include Cold Storage writes (async)
- Measured from call to result return

---

### Component Breakdown

| Component          | p50    | p99    | Notes              |
| ------------------ | ------ | ------ | ------------------ |
| Rate limiter check | ~10μs  | ~50μs  | O(1) map lookup    |
| Evidence creation  | ~100μs | ~500μs | Includes hashing   |
| Quarantine insert  | ~50μs  | ~200μs | Priority queue op  |
| AuditChain append  | ~20μs  | ~100μs | Linked list append |

---

## Memory Guarantees

### Quarantine Buffer

| Metric    | Default        | Configurable |
| --------- | -------------- | ------------ |
| Max items | 10,000         | Yes          |
| Max bytes | 100MB          | Yes          |
| Eviction  | Priority-based | —            |

### Memory Ceiling Behavior

When approaching limits:

| Usage  | Behavior                       |
| ------ | ------------------------------ |
| < 70%  | Normal operation               |
| 70-85% | Warning emitted                |
| 85-95% | Critical: accelerated eviction |
| > 95%  | Emergency: aggressive eviction |

---

## Eviction Under Pressure

### Priority-Based Eviction

Evidence is evicted based on:

1. **Priority** (low → high)
2. **Age** (oldest first within same priority)

### Eviction Guarantees

```
┌─────────────────────────────────────────────────────────────┐
│  Eviction NEVER blocks intercept().                        │
│  Eviction is synchronous but O(1) amortized.               │
│  High-priority evidence is evicted LAST.                   │
└─────────────────────────────────────────────────────────────┘
```

---

## HoundPool Performance

### Process-Based Isolation

| Tier       | Max Active | Memory Limit | Timeout      |
| ---------- | ---------- | ------------ | ------------ |
| Starter    | 1          | 64MB         | 5s           |
| Pro        | 8          | 512MB        | 30s          |
| Enterprise | Unlimited  | Configurable | Configurable |

### IPC Overhead

| Operation          | Typical | Under Load |
| ------------------ | ------- | ---------- |
| Spawn              | ~50ms   | ~100ms     |
| Message round-trip | ~1ms    | ~5ms       |
| Termination        | ~10ms   | ~50ms      |

---

## What This SLA Does NOT Cover

1. **Cold Storage writes** — Fire-and-forget, async
2. **Notification delivery** — Async, may be throttled
3. **HoundPool analysis** — Async, bounded by pool config
4. **Multi-instance coordination** — Network-dependent

---

## Measurement Methodology

All latency measurements assume:

- Node.js 18+ LTS
- Single-core normalized
- Warm JIT (after 1000+ calls)
- No GC pressure (< 70% heap usage)

---

## Related Documents

- [FAIL-OPEN-SPEC.md](./FAIL-OPEN-SPEC.md) — Failure behavior
- [LOCAL-STATE-SEMANTICS.md](./LOCAL-STATE-SEMANTICS.md) — Instance isolation
