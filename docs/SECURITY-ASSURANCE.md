# Security Assurance & Chaos Verification

This document outlines the proven facts, known limitations, and architectural rationale behind Tracehound's design as a High-Assurance Security Substrate. It is intended for Security Operations (SecOps) teams and architecture reviewers to understand both the empirical resilience of the system and its theoretical threat model gaps.

Tracehound is engineered on the principle that the security layer must **never** become a single point of failure for the host application.

---

## 1. Verified Invariants (The Facts)

Through our automated Local Chaos & Invariant Verification Suite (`npm run test:chaos`), the following architectural invariants are empirically tested and proven:

### 1.1 Guaranteed Fail-Open (Zombie Hound Survival)

Security middleware often introduces latency or deadlocks when its internal engines hang.

- **Proof:** We freeze a worker process (`SIGSTOP`) under load.
- **Result:** The system correctly identifies the timeout, bypasses the frozen worker, and allows traffic to flow to the business logic unhindered.
- **Conclusion:** A locked or stalled Tracehound worker cannot deadlock the main Node.js event loop.

### 1.2 Process Isolation (Poison Pill Resilience)

In-memory engines are vulnerable to memory corruption, native module crashes, or out-of-memory (OOM) exceptions.

- **Proof:** We crash a worker process instantly (`SIGKILL`).
- **Result:** The main application thread survives without interruption, and a replacement worker is seamlessly spawned.
- **Conclusion:** Tracehound's blast radius is strictly contained within its child processes. The host application is mathematically isolated from security engine crashes.

### 1.3 Catastrophic I/O Starvation Survival

Audit logs are critical, but a full or read-only disk should not break the API.

- **Proof:** We lock down write permissions (`chmod 400`) on the `AuditChain` directory to simulate catastrophic disk failure.
- **Result:** Tracehound detects the write failure, degrades gracefully, and maintains application availability (Fail-Open).
- **Conclusion:** Infrastructure-level I/O failures do not propagate to the business layer.

---

## 2. Threat Model Distinctions (The Narrative)

Tracehound positions itself not as a "magic AI box", but as a **Deterministic Security Substrate**. When evaluating Tracehound against traditional WAFs or in-app RASP solutions, consider the following design trade-offs:

1. **Standard In-App Middleware (e.g., Express Security Layers):**
   - _Risk:_ If a standard middleware encounters an algorithmic worst-case scenario (like ReDoS) or an OOM error, the entire Node.js server crashes.
   - _Advantage of Tracehound:_ We offload the dangerous parsing/analysis to an OS-isolated child process. The host app is safe.

2. **Network WAFs (e.g., Cloudflare, AWS WAF):**
   - _Risk:_ Network proxies block traffic based on generic signatures but lack application context (e.g., user roles, business logic state).
   - _Advantage of Tracehound:_ Sitting right inside the application's request lifecycle, Tracehound possesses full context without sacrificing the resilience of a standalone WAF.

---

## 3. Known Limitations & Audit Gaps (The Unknowns)

For full transparency during security audits, the following theoretical vulnerabilities and edge cases remain outside the scope of Tracehound's deterministic guarantees:

### 3.1 Blind Spot Injection (Fail-Open Exploitation)

Because Tracehound strictly adheres to a Fail-Open policy, a sophisticated attacker could intentionally trigger a Fail-Open state (e.g., via intense localized DDoS or triggering complex rules that cause timeouts) and immediately follow up with a malicious payload while the system is bypassing checks.

- _Mitigation:_ The timeout window is extremely small (e.g., `100ms`). Rate limiters are designed to clamp down on the IP _before_ the attacker has time to coordinate a secondary attack.

### 3.2 Pre-Extraction Vulnerabilities (Scent Generation)

Tracehound only analyzes traffic _after_ the host application has extracted the `Scent` (headers, body, etc.).

- _Risk:_ If the host's body parser (e.g., `express.json`) crashes due to an oversized payload or a prototype pollution attack _before_ Tracehound receives the request, the application will still fall over.
- _Mitigation:_ Host applications must impose strict body size limits and use safe parsing libraries upstream of Tracehound.

### 3.3 Audit Log Tampering by `root`

While the local `AuditChain` uses hash linking to become Tamper-Evident for application-level users, it relies on file system security.

- _Risk:_ An attacker who gains root OS access can simply `rm -rf` the entire audit directory, destroying the evidence chain.
- _Mitigation:_ Mission-critical environments should stream Tracehound logs to an external, write-only SIEM or syslog server immediately.

---

## Conclusion

Tracehound's primary value proposition to SecOps is **Zero-Harm Integration**. By strictly controlling its resource footprint and enforcing OS-level child process isolation, it provides a safe, high-speed conduit for running advanced security heuristics—ensuring that the defense mechanisms never become the application's greatest vulnerability.
