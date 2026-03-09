# Tracehound Threat Model

This document describes the implemented threat boundary of Tracehound core and its adapters. It focuses on what the runtime is designed to preserve, what it intentionally does not do, and which residual risks remain.

---

## 1. What Tracehound Is Not

Tracehound is a deterministic runtime evidence buffer. It is not:

1. a semantic detection engine
2. a business-logic authorization layer
3. a kernel, container, or VM isolation boundary
4. a guarantee of lossless downstream delivery

Tracehound consumes externally produced threat signals. It does not decide whether traffic is malicious on its own.

---

## 2. Assets and Trust Boundaries

### 2.1 Protected runtime properties

Tracehound is designed to preserve:

1. deterministic intercept behavior
2. bounded evidence retention in quarantine
3. tamper-evident audit records within the local trust boundary
4. host survivability when Tracehound itself fails internally

### 2.2 Important boundaries

1. Raw payload bytes remain inside the quarantine boundary.
2. Adapters are thin wrappers and should not add policy decisions.
3. Notifications and webhooks are auxiliary control-plane paths, not part of the request hot path.
4. Child-process separation reduces blast radius, but it is not a claim of absolute OS-enforced sandboxing.

---

## 3. Predictable Failure Modes

### 3.1 Internal Tracehound failure

If Tracehound fails internally during intercept processing, `agent.intercept()` returns `status: 'error'`.

Default adapter behavior:

1. Express and Fastify pass the request through by default.
2. Applications may opt into custom `onIntercept` handling when they explicitly own the response contract.

### 3.2 Capacity pressure

When bounded stores or queues fill up:

1. quarantine uses deterministic eviction
2. notification subscribers may drop oldest queued events
3. webhook delivery may drop queued jobs or reject unsafe destinations

This behavior favors host stability over lossless auxiliary delivery.

### 3.3 Downstream sink failure

Cold storage, notifications, and webhook sinks are not allowed to turn Tracehound into a blocking dependency for request handling.

---

## 4. Residual Risks

### 4.1 Fail-open blind spot

Fail-open preserves availability, but an attacker may benefit from a temporary analysis blind spot if they can push Tracehound into internal error states.

### 4.2 Upstream parser risk

Tracehound receives already-extracted `Scent` data. If the framework or body parser fails before Tracehound sees the request, that failure is outside Tracehound's protection boundary.

### 4.3 Privileged host compromise

A privileged attacker on the host can interfere with local files, processes, and memory. Tracehound does not claim immunity against privileged-host compromise.

### 4.4 Operator-controlled integrations

Webhook targets, archival sinks, and surrounding logging pipelines are part of the deployment environment. Misconfiguration in those systems can still create operational or compliance risk outside core runtime guarantees.

---

## 5. Data and Compliance Notes

Tracehound's design limits raw payload egress from quarantine, but compliance posture is still deployment-specific.

This repository does not currently expose:

1. a route-policy DSL
2. a built-in `FilterConfig` surface
3. automatic custom PII redaction guarantees for arbitrary application fields

Teams remain responsible for upstream parsing policy, downstream retention policy, and environment-specific compliance controls.

---

## Related Documents

- [FAIL-OPEN-SPEC.md](./FAIL-OPEN-SPEC.md)
- [SECURITY-ASSURANCE.md](./SECURITY-ASSURANCE.md)
- [LOCAL-STATE-SEMANTICS.md](./LOCAL-STATE-SEMANTICS.md)
