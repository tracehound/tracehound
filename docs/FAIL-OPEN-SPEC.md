# Fail-Open Behavior Specification

> **Version:** 1.0
> **Status:** Normative
> **Applies to:** @tracehound/core v1.0.0+

---

## Executive Summary

Tracehound follows **fail-open** semantics: when the security subsystem encounters an error, traffic **passes through** rather than blocking. This prevents security tooling from becoming a denial-of-service vector.

---

## Core Invariant

```
┌─────────────────────────────────────────────────────────────┐
│  Tracehound NEVER blocks legitimate traffic due to its     │
│  own failures. Security failures degrade gracefully,       │
│  not catastrophically.                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Failure Modes

### 1. Agent.intercept() Error Handling

```typescript
// Agent catches ALL errors and returns a status
// It NEVER throws to the caller

try {
  // ... processing
} catch (error) {
  return { status: 'error', error: tracehoundError }
}
```

**Caller responsibility:** Check `status === 'error'` and decide action.
**Default recommendation:** Pass traffic through, log the error.

---

### 2. FailSafe Panic System

Three-level threshold-triggered callbacks:

| Level     | Memory | Quarantine | Error Rate |
| --------- | ------ | ---------- | ---------- |
| warning   | 70%    | 70%        | 10/min     |
| critical  | 85%    | 85%        | 50/min     |
| emergency | 95%    | 95%        | 100/min    |

**Callbacks are fire-and-forget:**

```typescript
// Callbacks never block, never throw
catch {
  // Swallow sync errors - fail-safe must not throw
}
```

---

### 3. What Degrades vs. What Never Degrades

| Never Degrades    | May Degrade Under Pressure |
| ----------------- | -------------------------- |
| Agent.intercept() | HoundPool processing       |
| Quarantine insert | Cold Storage writes        |
| AuditChain append | Notification delivery      |
| Rate limiting     | SecurityState snapshots    |

---

## Integration Guide

### Recommended Pattern

```typescript
const result = tracehound.agent.intercept(scent)

switch (result.status) {
  case 'clean':
  case 'quarantined':
  case 'ignored':
  case 'rate_limited':
    // Normal operation
    break

  case 'error':
    // FAIL-OPEN: Log and pass through
    logger.error('Tracehound error', result.error)
    // Continue processing request
    break
}
```

### Anti-Pattern (DO NOT DO)

```typescript
// ❌ WRONG: Blocking on Tracehound error
if (result.status === 'error') {
  return res.status(500).send('Security error')
}
```

---

## Panic Callback Usage

```typescript
tracehound.failSafe.on('emergency', (event) => {
  // Notify ops, but don't block traffic
  alertOps(event)
})

tracehound.failSafe.on('critical', (event) => {
  // Reduce non-essential processing
  disableHoundPool()
})
```

---

## Rationale

1. **Security tools must not become attack vectors** - If Tracehound crashes under load, attackers could exploit this to block all traffic.
2. **Observability over blocking** - Better to log a threat you couldn't fully process than to deny service.
3. **Explicit degradation** - The system tells you what degraded; it doesn't hide failures.

---

## Related Documents

- [PERFORMANCE-SLA.md](./PERFORMANCE-SLA.md) - Latency guarantees
- [LOCAL-STATE-SEMANTICS.md](./LOCAL-STATE-SEMANTICS.md) - Instance isolation
