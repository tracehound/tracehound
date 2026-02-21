# Resilience Edge V2 Roadmap

This roadmap outlines the next evolution of Tracehound's deterministic security guarantees. While Tracehound v1 achieved isolated processing and fail-open survival, v2 focuses on **Developer Experience (DX) simplicity**, **Pre-extraction safety**, and **Zero-overhead cold storage**.

## 1. Mitigation of Blind Spot Injection (Fail-Open Exploitation)

**Problem:** An attacker can exhaust system resources with a localized DDoS, forcing Tracehound into a Fail-Open (Timeout) state, and subsequently slip a malicious payload past the defenses during the bypass window.
**Solution:** A dual-layered approach combining **Adaptive Rate Limiting** and **Route-Specific Fallback Policies**, supported by automated DX tooling.

### Key Capabilities

- **Adaptive Rate Limiting (Penalty Scoring):** If a request causes a timeout in the `HoundPool` triggering a Fail-Open, a "Penalty Score" is instantly assigned to the originating IP or Session. The Rate Limiter immediately throttles that source's limit by a factor of 10x, mathematically preventing sustained fail-open abuse.
- **Route-Specific Fallback Policies:** Not all routes require the same resilience strategy. While `/api/public/articles` is perfect for Fail-Open, critical endpoints like `/api/auth/login` or `/api/payments` can be configured as **Fail-Closed** (rejecting requests on timeout).
- **CLI-Driven Configuration (The DX Leap):** To prevent tedious manual configuration of route policies, engineers can run `npx tracehound init --scan=openapi.yaml` (or use flags like `--keywords="login,auth"`). Tracehound generates a draft `tracehound.routes.yml` file, applying intelligent defaults. The team reviews and commits the rules before enforcement.
- **Why this matters:** Closes the theoretical fail-open bypass window under heavy load while keeping the developer experience seamless.

## 2. Pre-Extraction Raw HTTP Shield (Core Opt-in)

**Problem:** Frameworks like Express and Fastify are vulnerable to ReDoS or oversized payload memory exhaustion _before_ they pass the parsed `req.body` to the Tracehound middleware.
**Solution:** A native Tracehound Shield that attaches directly to the Node.js `http.IncomingMessage` stream, bypassing framework logic entirely.

### Key Capabilities

- Integrated directly into core, enabled via configuration (`enableShield: true`). We will NOT split this into a separate `@tracehound/shield` package to avoid fragmentation and protect the commercial value of our satellite modules.
- It attaches on a **per-instance** basis. A standard Node.js `http.createServer()` is wrapper with the shield interceptor, which listens to the raw TCP stream events (`req.on('data')`).
- If a payload exceeds the predefined deterministic limit, the socket is instantly and violently destroyed (`req.socket.destroy()`). No CPU cycles are wasted on parsing headers or bodies.

## 3. Asynchronous Firehose Forwarder (Zero-Overhead Remote Sinks)

**Problem:** SecOps needs centralized logs (SIEM, AWS S3), but writing to network storage during a request lifecycle introduces massive p99 latency spikes and violates our sub-millisecond execution guarantee (The "Overhead Pranga").
**Solution:** Out-of-band log forwarding using the existing Tracehound `Scheduler`.

### Key Capabilities

- The `Agent` continues to write synchronously only to the local, tamper-evident `AuditChain` or in-memory `Quarantine`, ensuring zero latency impact to the host application's request cycle.
- The Jittered Background Worker (`Scheduler`) reads batched events from the local disk every `N` seconds or when the buffer reaches a threshold.
- The worker executes a Write-Only stream to the remote sink (Firehose, S3 WORM bucket, or Datadog) completely asynchronously.
- **Why this matters:** Secures the audit trail against local root compromises without sacrificing runtime performance.
