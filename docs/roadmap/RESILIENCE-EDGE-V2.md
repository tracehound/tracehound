# Resilience Edge V2 Roadmap

This roadmap outlines the next evolution of Tracehound's deterministic security guarantees. While Tracehound v1 achieved isolated processing and fail-open survival, v2 focuses on **Developer Experience (DX) simplicity**, **Pre-extraction safety**, and **Zero-overhead cold storage**.

## 1. CLI-Driven Route Policies (The DX Leap)

**Problem:** Manual configuration of route-specific fail-open / fail-closed policies is tedious and error-prone.
**Solution:** A built-in CLI command to automatically scan the project (via OpenAPI spec or route scanning) and generate a draft policy file.

### Key Capabilities

- Developers can run `npx tracehound init --scan=openapi.yaml` (or pass specific keywords using a flag like `--keywords="login,auth,pay"`).
- Tracehound will NOT blindly enforce generated rules. It will output a descriptive YAML/TS configuration file (e.g., `tracehound.routes.yml`).
- This allows the engineering team to manually review, modify, and commit the generated route policies before they become active.
- **Why this matters:** Reduces WAF/Security policy configuration time from days to minutes while keeping the final decision strictly in the hands of the developer.

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
