# Local State Semantics

> **Version:** 1.1
> **Status:** Normative
> **Applies to:** @tracehound/core v1.0.0+

---

## Important Warning

```
┌─────────────────────────────────────────────────────────────┐
│  ⚠️ EACH TRACEHOUND INSTANCE OWNS ITS OWN STATE            │
│                                                             │
│  There is NO global blocklist.                              │
│  There is NO cross-instance coordination.                   │
│  There is NO shared quarantine.                             │
│                                                             │
│  This is by design. See rationale below.                    │
└─────────────────────────────────────────────────────────────┘
```

---

## What "Local State" Means

Each Tracehound instance maintains:

| Component          | Scope        | Shared? |
| ------------------ | ------------ | ------- |
| Quarantine         | Per-instance | ❌ No   |
| AuditChain         | Per-instance | ❌ No   |
| Rate limiter state | Per-instance | ❌ No   |
| Evidence           | Per-instance | ❌ No   |
| FailSafe history   | Per-instance | ❌ No   |

---

## Implications

### 1. Rate Limiting is Per-Instance

```typescript
// Instance A: source "1.2.3.4" blocked
// Instance B: source "1.2.3.4" NOT blocked

// Each instance maintains its own token buckets
```

### 2. Duplicate Detection is Per-Instance

```typescript
// Same scent sent to Instance A and Instance B
// Both will quarantine it (no dedup across instances)
```

### 3. Evidence is Per-Instance

```typescript
// Evidence created on Instance A
// Cannot be retrieved from Instance B
// (unless exported to shared Cold Storage)
```

---

## When You Need Multi-Instance

If you need cross-instance coordination:

| Requirement          | Solution             | Package         |
| -------------------- | -------------------- | --------------- |
| Shared blocklist     | Redis coordination   | Horizon         |
| Global rate limiting | Redis coordination   | Horizon         |
| Evidence aggregation | Cold Storage + query | Core (async)    |
| Unified audit trail  | SIEM integration     | Core (notifier) |

> **Note:** Multi-instance coordination requires `@tracehound/horizon` ($9, perpetual).

---

## Why Local-First?

1. **Simplicity** — No distributed systems complexity by default
2. **Performance** — No network round-trips for core operations
3. **Reliability** — No Redis/network dependencies for basic security
4. **Isolation** — Instance failure doesn't cascade to others

---

## Multi-Instance Deployment Pattern

```
                    ┌─────────────┐
                    │ Load Balancer│
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │ Instance A  │ │ Instance B  │ │ Instance C  │
    │ (local state)│ │ (local state)│ │ (local state)│
    └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
           │               │               │
           └───────────────┼───────────────┘
                           ▼
                    ┌─────────────┐
                    │ Cold Storage│  ← Shared
                    │ (S3/R2/GCS) │
                    └─────────────┘
```

### Core Pattern (Default)

- Each instance operates independently
- Export to shared Cold Storage for aggregation
- Query Cold Storage for cross-instance analysis

### Horizon Pattern (Scale)

With `@tracehound/horizon`:

- Redis/KeyDB coordination layer
- Shared blocklist across instances
- Global rate limiting
- Real-time cross-instance sync

```typescript
import '@tracehound/horizon'
import { Agent } from '@tracehound/core'

// Configure coordination
Agent.configure({
  horizon: {
    redis: 'redis://cluster:6379',
    sync: ['blocklist', 'rateLimit'],
  },
})
```

---

## Related Documents

- [FAIL-OPEN-SPEC.md](./FAIL-OPEN-SPEC.md) — Failure behavior
- [PERFORMANCE-SLA.md](./PERFORMANCE-SLA.md) — Latency guarantees
- [PRICING.md](./PRICING.md) — Package pricing
