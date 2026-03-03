# Resilience Edge V2 Roadmap & Risk Analysis

> [!NOTE]
> Source module document. The authoritative technical roadmap is
> [TRACEHOUND-UNIFIED-ROADMAP.md](./TRACEHOUND-UNIFIED-ROADMAP.md).

This roadmap outlines the next evolution of Tracehound's deterministic security guarantees. While Tracehound v1 achieved isolated processing and fail-open survival, v2 focuses on **Developer Experience (DX) simplicity**, **Pre-extraction safety**, and **Zero-overhead cold storage**.

> [!WARNING]
> This document has been updated with a rigorous Execution-Grade Analysis based on global architectural constraints. Severe failure modes, second-order effects, and unknowns have been identified for each module. A final Action Plan determines whether to proceed, pivot, or abandon these features.

## 1. Mitigation of Blind Spot Injection (Fail-Open Exploitation)

**Problem:** An attacker can exhaust system resources with a localized DDoS, forcing Tracehound into a Fail-Open (Timeout) state, and subsequently slip a malicious payload past the defenses during the bypass window.

**Proposed Solution:** A dual-layered approach combining **Adaptive Rate Limiting (Penalty Scoring)** and **Route-Specific Fallback Policies**, supported by automated DX tooling (`tracehound.routes.yml`).

### Critical Analysis & Threats

- **Second-Order Effect (Negative):** CGNAT (Carrier-Grade NAT) environments will cause legitimate users in a corporate/campus network to be banned if a single malicious actor on the same IP triggers the Penalty Score.
- **Blast Radius:** High. Misconfiguration of the generated `tracehound.routes.yml` could lead to critical endpoints failing closed under load, effectively causing a self-inflicted Denial of Service (DoS) and stopping revenue.
- **Fragility:** Parsing OpenAPI specs into framework-specific route patterns (e.g., `/users/{id}` to `/users/:id`) is highly fragile.

## 2. Pre-Extraction Raw HTTP Shield (Core Opt-in)

**Problem:** Frameworks like Express and Fastify are vulnerable to ReDoS or oversized payload memory exhaustion _before_ they pass the parsed `req.body` to the Tracehound middleware.

**Proposed Solution:** A native Tracehound Shield (`enableShield: true`) that attaches directly to the Node.js `http.IncomingMessage` stream, instantly destroying the socket (`req.socket.destroy()`) if deterministic limits are breached.

### Critical Analysis & Threats

- **Second-Order Effect (Negative):** Destroying the socket with an `ECONNRESET` (RST flag) instead of a graceful `413 Payload Too Large` will cause well-intentioned frontend clients or mobile apps to enter an infinite retry loop, turning a large payload error into an accidental DDoS attack.
- **Blast Radius:** Maximum. A minor bug in the stream listener or an unhandled rejection in this raw layer will instantly crash the entire Node.js process (OOM or Event Loop panic).
- **Fragility:** Vanilla Node HTTP core events. Any internal V8/Node.js changes to stream handling across versions could break the shield.

## 3. Asynchronous Firehose Forwarder (Zero-Overhead Remote Sinks)

**Problem:** SecOps needs centralized logs (SIEM, AWS S3), but writing to network storage during a request lifecycle introduces massive p99 latency spikes and violates our sub-millisecond execution guarantee ("The Overhead Pranga").

**Proposed Solution:** The `Agent` writes synchronously only to a local, tamper-evident `AuditChain` (Write-Ahead Log on disk) or in-memory Quarantine. A Jittered Background Worker (`Scheduler`) reads batched events and streams them remotely.

### Critical Analysis & Threats

- **Second-Order Effect (Negative):** Security teams will inevitably face a 3-10 second blind spot due to batch limits and network jitter. SOC dashboards will not be strictly real-time.
- **Blast Radius:** High. If the remote sink (e.g., Datadog) goes down or rate-limits the connection, the local WAL will grow indefinitely. On environments with limited disk space, this will cause a `ENOSPC` (Disk Full) error, crashing the host OS and the main application.
- **Unknowns & Constraints:** Ephemeral/Serverless environments (AWS Fargate, Vercel) often have Read-Only filesystems or no persistent disk. The local WAL strategy will instantly panic on these platforms.

---

## 🚀 Action Plan & Strategic Pivot

Given the severe systemic risks identified in the execution-grade analysis, we are establishing two foundational **Product Axioms** that override all previous technical considerations:

1. **Axiom 1: Pure Application-Level Survivability.** Tracehound is an App-Level security substrate, not a Kernel module. **If Tracehound crashes, the host application MUST survive.** No security mechanism may introduce a risk of hard-crashing the V8 isolate or Node process (e.g., via `ENOSPC` disk exhaustion or unhandled socket stream errors).
2. **Axiom 2: Strictly Stateless Network Containment.** Tracehound will NOT become Identity-Aware (e.g., parsing JWT claims). Mixing network defense with business-logic identity creates severe circular dependencies. We accept the reduced spoofing entropy (Hash of IP + User-Agent) as a mathematical trade-off, mitigating it through aggressive penalty decay algorithms rather than deep identity coupling.

With these axioms established, the following operational pivots are mandatory:

### Module 1: Fail-Open Mitigation (Stateless Policy Enforcement)

**Decision:** PIVOT TO STRICT STATELESS BINDING
**Action:** We will drop the "Optional Custom Header/JWT Claim" approach to remain strictly stateless. The Penalty Score will rely purely on Network/Transport layer entropy: `Hash(IP + UserAgent + TLSCipherSuite)`. While trivially spoofable by advanced bots, this guarantees Tracehound remains isolated from the application's authentication logic. Furthermore, the CLI router generator will be explicitly downgraded to an "Advisor" mode to prevent auto-hardening blasts that could self-DoS the application.

### Module 2: Raw HTTP Shield (Application-Safe Streaming)

**Decision:** ABANDON SOCKET DESTRUCTION
**Action:** Violently destroying sockets (`req.socket.destroy()`) is unacceptable because an error in stream handling will crash the Node Event Loop (violating Axiom 1), and resetting connections causes client-side exponential retry amplification.
**New Path:** We will intercept the stream to forcefully drain oversized payloads and immediately write a graceful `HTTP/1.1 413 Payload Too Large` response. If this parser fails, it will emit a standard application-level error gracefully caught by the framework, guaranteeing host survival.

### Module 3: Asynchronous Firehose (Memory-First Defaults)

**Decision:** PIVOT TO SERVERLESS NATIVE
**Action:** The risk of OS-level disk-full (`ENOSPC`) crashes directly violates Axiom 1. SOC monitoring can tolerate a 5-second blind spot, but a system cannot tolerate a kernel freeze.
**New Path:** Implement a **Ring Buffer (In-Memory WAL)** as the default for all environments (Serverless/Fargate/Vercel compliant). The system will strictly prioritize Host Survival over Forensic Completeness (Data Loss > Node Crash). Disk-based WAL will be restricted to an opt-in flag for legacy persistent-volume setups.
