# Evidence Lifecycle Policy

> **Version:** 1.0
> **Status:** Normative
> **Applies to:** @tracehound/core v1.1.0+ (Pro/Enterprise)

---

## Overview

This document specifies evidence retention, eviction, and cleanup policies.

---

## Evidence States

```
┌─────────────┐    insert()    ┌─────────────┐
│   Created   │ ─────────────► │ Quarantined │
└─────────────┘                └──────┬──────┘
                                      │
                     ┌────────────────┼────────────────┐
                     ▼                ▼                ▼
              ┌───────────┐    ┌───────────┐    ┌───────────┐
              │  Evicted  │    │ Evacuated │    │ Purged    │
              │ (dropped) │    │ (archived)│    │ (deleted) │
              └───────────┘    └───────────┘    └───────────┘
```

---

## Retention Policy

### Quarantine (Hot Storage)

| Setting  | Default | Range           |
| -------- | ------- | --------------- |
| maxCount | 10,000  | 100 - 1,000,000 |
| maxBytes | 100MB   | 1MB - 10GB      |
| maxAge   | None    | Optional TTL    |

### Cold Storage (Archive)

| Tier       | Retention | Deletion     |
| ---------- | --------- | ------------ |
| Pro        | 30 days   | Automatic    |
| Enterprise | 1 year+   | Policy-based |

---

## Eviction Policy

### Priority-Based Eviction

When quarantine is full, evidence is evicted by:

1. **Severity Priority** (low → high)
   - `low` = 0
   - `medium` = 1
   - `high` = 2
   - `critical` = 3

2. **Age** (oldest first within same priority)

```typescript
// Eviction order
1. Low severity, oldest first
2. Medium severity, oldest first
3. High severity, oldest first
4. Critical severity LAST
```

### Eviction Actions

| Action   | Behavior                                 |
| -------- | ---------------------------------------- |
| drop     | Evidence discarded, logged to AuditChain |
| evacuate | Evidence written to Cold Storage first   |

---

## TTL-Based Cleanup (Enterprise)

### Configuration

```typescript
interface RetentionConfig {
  // Hot storage TTL
  quarantineTTL?: number // ms, default: none

  // Cold storage TTL
  coldStorageTTL?: number // ms, default: 30 days

  // Cleanup interval
  cleanupInterval?: number // ms, default: 1 hour
}
```

### Cleanup Behavior

```
┌─────────────────────────────────────────────────────────────┐
│  TTL cleanup is BACKGROUND ONLY                            │
│  Never blocks intercept()                                  │
│  Never causes hot-path latency                             │
└─────────────────────────────────────────────────────────────┘
```

---

## GDPR Compliance

### Right to Erasure (Enterprise)

```typescript
interface ErasureRequest {
  // Identifiers to erase
  sourceId?: string // IP, user ID
  evidenceIds?: string[] // Specific signatures

  // Scope
  scope: 'quarantine' | 'cold-storage' | 'all'
}
```

### Erasure Guarantees

| Layer        | Erasure Time | Verification     |
| ------------ | ------------ | ---------------- |
| Quarantine   | Immediate    | AuditChain entry |
| Cold Storage | < 24 hours   | Deletion receipt |

---

## Audit Trail

All lifecycle events are logged:

```typescript
type LifecycleEvent =
  | { action: 'insert'; evidenceId: string }
  | { action: 'evict'; evidenceId: string; reason: 'capacity' | 'ttl' }
  | { action: 'evacuate'; evidenceId: string; destination: string }
  | { action: 'purge'; evidenceId: string; reason: 'policy' | 'erasure' }
```

---

## Related Documents

- [COLD-STORAGE-SECURITY.md](./COLD-STORAGE-SECURITY.md) — Storage security
- [FAIL-OPEN-SPEC.md](./FAIL-OPEN-SPEC.md) — Failure behavior
- [PERFORMANCE-SLA.md](./PERFORMANCE-SLA.md) — Latency guarantees
