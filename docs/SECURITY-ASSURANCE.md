# Security Assurance & Chaos Verification

This document summarizes what is currently verified in code and tests, what is deliberately bounded, and what remains outside Tracehound's assurance boundary.

Tracehound's design goal is straightforward: internal security-path failure must not take down the host application.

---

## 1. Verified Runtime Behaviors

### 1.1 Fail-open under worker pressure

The repository includes a local chaos suite (`pnpm test:chaos`) that exercises pool exhaustion and timeout behavior against a running target application.

Current chaos coverage verifies:

1. saturating the hound pool does not permanently deadlock request flow
2. clean traffic continues returning application responses within a bounded latency budget during mixed pressure
3. pool recovery occurs after burst pressure without manual intervention
4. trace inspection output resumes after recovery and remains observable via opaque trace ids for quarantined responses only

These checks validate host availability behavior. They do not prove perfect detection coverage during degraded windows.

### 1.2 Auxiliary sink failure survival

The same chaos suite now sabotages the real local disk sinks that exist in the runtime:

1. signed runtime snapshot export
2. trace inspection registry writes used by opaque `x-tracehound-trace-id` inspection

What is verified:

1. sink write failure emits operator-visible panic/telemetry
2. quarantined responses still emit opaque `x-tracehound-trace-id` headers before and during trace-registry sink failure
3. quarantined and clean host traffic remain reachable instead of becoming an availability failure
4. signed snapshot export can be verified before sabotage and fails closed on read once the sink is broken

### 1.3 Integrity verification on signed artifacts

Runtime snapshot verification uses HMAC-SHA256 with constant-time signature comparison. Evidence hash verification also uses constant-time comparison in the evidence constructor.

These checks are implemented in code and covered by unit tests.

---

## 2. Assurance Boundary

Tracehound provides:

1. deterministic intercept handling for externally supplied threat signals
2. bounded quarantine and bounded notification delivery
3. fail-open adapter behavior on internal Tracehound errors
4. tamper-evident audit chaining within the trust boundary of the host

Tracehound does not provide:

1. semantic threat detection
2. OS-enforced sandbox or VM-grade isolation guarantees
3. guaranteed lossless downstream delivery under sink failure
4. privileged-host tamper immunity

Process separation is part of the design, but it should be described as bounded blast-radius reduction, not absolute isolation.

---

## 3. Known Limitations

### 3.1 Fail-open bypass window

If Tracehound is degraded and returns `status: 'error'`, the host application continues. That preserves availability, but it can create a short analysis blind spot. In this window, a response may legitimately return HTTP 200 without an opaque trace header because no quarantine result was produced.

### 3.2 Upstream parser and framework risk

Tracehound operates after the host application extracts a `Scent`. If the upstream parser or framework fails before Tracehound sees the request, that failure is outside Tracehound's control.

### 3.3 Local audit trust boundary

The local audit chain is tamper-evident, not tamper-proof. A privileged attacker on the host can still destroy local files or interfere with local storage.

### 3.4 Bounded auxiliary planes

Notifications, webhooks, archival, and other downstream integrations are bounded to protect host stability. Under pressure or sink failure, they may drop work instead of preserving every outbound event.

---

## 4. Operational Reading

For reviews and audits, read Tracehound as:

1. a deterministic runtime evidence buffer
2. a fail-open library that preserves host survivability
3. a bounded control plane that favors stability over lossless delivery

Do not read it as:

1. a WAF replacement
2. a detection engine
3. a hard isolation boundary against a privileged host attacker

---

## Related Documents

- [FAIL-OPEN-SPEC.md](./FAIL-OPEN-SPEC.md)
- [THREAT-MODEL.md](./THREAT-MODEL.md)
- [CRITICAL-SECURITY-REMEDIATION-PLAN.md](./CRITICAL-SECURITY-REMEDIATION-PLAN.md)
