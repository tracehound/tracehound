# FAQ

### 1)

**Question:** "You say Tracehound isn't a WAF. So what threat class exactly are you addressing?"

**Reason:** Check if there's scope creep. Security products often overpromise.

**Answer:** "We don't do semantic exploit detection. We don't do signature-based or pattern-based attack classification. The problem we address: runtime resource exhaustion, anomalous request amplification, and bounded containment. The system doesn't try to understand the type of attack; it limits its cost."

**Conclusion:** Clarity builds trust.

---

### 2)

**Question:** "When forced into fail-open mode, can't an attacker deliberately create a bypass?"

**Reason:** They want to challenge the claim of determinism.

**Answer:** "Fail-open is our preference for preserving system stability. However, fail-open triggering is not dependent on a single parameter. There is composite penalty scoring. Furthermore, the fail-open duration is bounded and telemetry is generated. This situation could create a bypass window, but it is less risky than a system crash."

**Conclusion:** It is important to be able to say "yes, there is risk, but it is bounded."

---

### 3)

**Question:** "Can the composite key IP + UA be spoofed? Is this sufficient entropy?"

**Reason:** It's a simple bot bypass test.

**Answer:** "As of v1.7.1, the composite key includes IP + User-Agent + TLS metadata (cipher suite, protocol version, ALPN) when available over HTTPS connections. The rate limiter uses a two-tier design: a composite fingerprint key for fine-grained per-client tracking, and an IP-only ceiling that caps total requests from one IP address regardless of fingerprint rotation. This prevents a client from minting fresh rate-limit buckets by rotating User-Agent strings or TLS parameters. The composite key is SHA-256 hashed for deterministic, log-safe source identification."

**Important deployment caveat:** "TLS metadata is extracted from the server-side socket. Behind a TLS-terminating proxy or CDN, the TLS fields reflect the proxy-to-server connection — not the original client — and may be unavailable or identical across all clients. In such deployments, the TLS component of the composite key provides no additional entropy; the IP-only ceiling still applies, but the IP seen will be the proxy's egress address. Deploy Tracehound at the TLS termination point, or use trusted forwarded headers (e.g. X-Forwarded-For with proxy trust configured), to retain per-client IP accuracy."

**Conclusion:** The two-tier design (composite fingerprint + IP ceiling) eliminates the rotation bypass surface. Proxy deployments must account for TLS termination topology.

---

### 4)

**Question:** "What happens if a bug in the raw HTTP layer crashes the Node process?"

Why it is asked: Blast radius.

**Answer:** "We try to isolate the shield layer and produce a graceful 413 response. However, since we operate at the application level, we do not provide kernel isolation. Therefore, the crash containment boundary is the Node process. This risk is documented."

**Conclusion:** This honest answer is more valuable than claiming kernel-level isolation.

---

### 5)

**Question:** "What happens if the remote sink goes down during SIEM integration?"

**Reason:** Operational realism.

**Answer:** "We use the default memory ring buffer. Disk WAL is opt-in. In case of remote sink failure, we prefer overwrite, not crash. Data loss is bounded; host stability is prioritized."

**Conclusion:** Honesty, Clarity

---

### 6)

**Question:** "What is your false positive rate?"

**Reason:** Product seriousness test.

**Answer:** "We don't provide semantic decisions, so there's no classic FP metric. Limit violations are deterministic. False positives arise at the configuration level. That's why we provide advisory tooling."

**Conclusion:** This clarifies the product positioning.

---

### 7)

**Question:** "Which of the OWASP Top 10 do you block?"

Possible reference: OWASP

**Answer:** "We don't semantically detect the injection classes in the Top 10. However, we apply containment for rate abuse, payload amplification, and anomalous size patterns. We are an impact bounding layer, not detection."

**Conclusion:** Never say "we block."

---

### 8)

**Question:** "What is the worst-case scenario if we deploy this product to production?"

This is a critical question.

**Answer:** "The worst-case scenario is self-DoS due to misconfiguration. The second scenario is local resource exhaustion. That's why advisory mode and bounded buffers were designed. There is no silent undefined behavior."

**Conclusion:** This answer demonstrates maturity.
