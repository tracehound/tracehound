# Fail-Open Behavior Specification

> **Version:** 1.1
> **Status:** Normative
> **Applies to:** `@tracehound/core`, `@tracehound/express`, `@tracehound/fastify`

---

## Executive Summary

Tracehound follows fail-open semantics for internal security-path failures. When Tracehound cannot complete its own processing safely, it surfaces an internal error state and the host application continues operating.

This document describes the current implemented contract. It does not describe hypothetical route policies, fail-closed modes, or unpublished extension behavior.

---

## Core Invariant

```
┌─────────────────────────────────────────────────────────────┐
│  Tracehound must not become a denial-of-service vector     │
│  for the host application because of Tracehound's own      │
│  internal failure paths.                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Failure Surfaces

### 1. `agent.intercept()` error handling

`agent.intercept()` returns `{ status: 'error', error: TracehoundError }` when Tracehound fails internally.

1. The hot path returns an `InterceptResult`; it does not require callers to catch Tracehound exceptions in normal operation.
2. Callers must handle `status === 'error'` explicitly.
3. The recommended default action is pass-through plus operator-side logging or notification.

### 2. Official adapter default

The official Express and Fastify adapters treat `status === 'error'` as pass-through by default.

1. If no custom `onIntercept` handler is configured, the adapter does not emit a terminal `500`.
2. If a custom `onIntercept` handler writes a response, that application-owned response contract takes precedence.
3. If a custom handler throws after response start, the adapter delegates to the framework error pipeline.

### 3. Pressure and degradation signals

Tracehound exposes degradation through operator channels rather than by forcing a default client-visible error response.

1. `th.notifications` may emit `system.panic` and other runtime events.
2. `th.watcher.snapshot()` exposes runtime pressure and alert state.
3. Notification delivery itself is bounded and may drop or reject downstream deliveries under pressure.

### 4. What may degrade

| Synchronous runtime contract | Auxiliary path that may degrade |
| ---------------------------- | ------------------------------- |
| `agent.intercept()` returns  | HoundPool analysis              |
| Quarantine insert semantics  | Cold storage archival           |
| Audit chain append           | Notification/webhook delivery   |

Fail-open does not mean "nothing is lost." It means host traffic is preserved when Tracehound's own internals degrade.

---

## Integration Guide

### Recommended pattern

```typescript
const result = tracehound.agent.intercept(scent)

switch (result.status) {
  case 'clean':
  case 'quarantined':
  case 'ignored':
  case 'rate_limited':
  case 'payload_too_large':
    break

  case 'error':
    logger.error('Tracehound internal error', result.error)
    // Continue host request flow.
    break
}
```

### Anti-pattern

```typescript
if (result.status === 'error') {
  return res.status(500).send('Security error')
}
```

Do not turn Tracehound internal failure into an automatic host-layer denial of service unless your application explicitly owns that response policy.

---

## Rationale

1. Security controls must not become an attacker-controlled traffic breaker.
2. Operator visibility should live in logs, snapshots, and notifications before it lives on the wire.
3. Degradation should be explicit, bounded, and reviewable.

---

## Related Documents

- [API.md](./API.md)
- [PERFORMANCE-SLA.md](./PERFORMANCE-SLA.md)
- [LOCAL-STATE-SEMANTICS.md](./LOCAL-STATE-SEMANTICS.md)
