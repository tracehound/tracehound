# Tracehound Threat Model & Liability Boundary

This document outlines the deterministic security boundaries, predictable failure modes, and legal/liability constraints of the Tracehound Resilience Edge. It is designed for Security Operations Centers (SOC), Chief Information Security Officers (CISO), and Enterprise Engineering teams to establish a crystalline understanding of the product's operational behavior under extreme duress.

## 1. Clear Liability Boundary ("What Tracehound Is Not")

To establish enterprise credibility, Tracehound strictly defines its operational and legal boundaries. **Tracehound operates as a deterministic network and payload containment substrate. It does NOT make business-logic security decisions.**

### 1.1 Out of Scope & Zero Liability

- **Business Logic Flaws:** Tracehound cannot detect or prevent Insecure Direct Object References (IDOR), Broken Access Control, or authorization bypasses inherent to the host application's architecture.
- **Data Governance (GDPR/KVKK):** Tracehound does not automatically scrub Custom Personal Identifiable Information (PII) beyond standard predefined fields (e.g., Credit Cards, SSNs). The host application assumes all legal liability for ensuring customized data redactions are configured within Tracehound's `FilterConfig` before forensic logs reach the `AuditChain`.
- **Operating System Vulnerabilities:** Tracehound is an App-Level Buffer (Node.js/V8). It assumes no liability for kernel-level escalations, Docker container escapes, or underlying OS zero-day exploits.

## 2. Predictable Failure Modes

Security products must fail predictably without escalating the crisis. Tracehound guarantees the following failure behaviors when subjected to algorithmic or volumetric pressure (DoS/DDoS):

### 2.1 The "Hard Shedding" Principle (Memory Overrun)

- **Trigger:** A massive volumetric attack causes the in-memory Quarantine Ring Buffer to exceed its hardcoded deterministic limit (e.g., 50MB).
- **Failure Mode:** Tracehound completely aborts forensic archiving. It prioritizes host application survival by dropping all new malicious payloads from the log. It strictly increments a lightweight `dropped_events` integer.
- **Result:** Loss of forensic data (SOC Blind Spot), but zero risk of NodeJS Out-of-Memory (OOM) crashes.

### 2.2 The "Graceful Drain" Principle (Stream Exhaustion)

- **Trigger:** An attacker bypasses framework limits and streams a multi-gigabyte payload (e.g., 10GB `multipart/form-data`) to exhaust V8 memory via ReDoS or buffer blooming.
- **Failure Mode:** Tracehound intercepts the `http.IncomingMessage` stream. Once the byte limit is breached, it forcefully drains the remaining stream bytes directly into the void (to prevent OS backlog) and immediately emits a standard `HTTP/1.1 413 Payload Too Large` to the client.
- **Result:** The client connection is gracefully terminated without destroying the underlying socket abruptly (preventing client-side exponential retry amplification storms).

## 3. Bounded Blast Radius (Host Survivability)

A core tenet of Tracehound's architecture (Axiom 1) is: **If Tracehound crashes or throws an exception, the host application MUST survive.**

### 3.1 Unhandled Execution Panics

If a sub-module within Tracehound (e.g., the parser or regex engine) experiences a critical bug or infinite loop:

- Tracehound operates under an isolated temporal sandbox (Finite State Machine limitations).
- If the temporal threshold is breached, the execution is forcefully aborted.
- The request is immediately rejected (Fail-Closed) or passed (Fail-Open) based strictly on the static `tracehound.routes.yml` configuration. The host Node.js event loop is never allowed to hang indefinitely.

### 3.2 Storage/Disk Saturation (`ENOSPC`)

If the SIEM/Log streaming endpoint (e.g., Datadog, AWS S3) goes offline, on-disk WAL (Write-Ahead-Logs) will NOT fill up the host volume and crash the system.

- Tracehound heavily favors Memory-First Ring Buffers in production configurations (specifically for Serverless/Ephemeral environments).
- If Disk-based WAL is explicitly enabled, it contains a hard `quota_bytes` limit. Upon breach, older logs are aggressively purged to prevent underlying Database or file-system corruption on the host.
