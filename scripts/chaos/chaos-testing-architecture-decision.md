# Chaos Testing Architecture Decision

This document contains the strategic architectural justification for using a custom Node.js process-spawning chaos suite (`run-chaos-suite.ts`) instead of generic 3rd-party infrastructural chaos tools like Pumba or Toxiproxy.

These arguments are formulated under strict execution-grade engineering rules and should be used to defend the architectural choices.

## 1. SHORTCUT PROHIBITION

This solution was chosen not because it is simple, but because it is the most accurate method to validate Tracehound's security model.

### Rejected Alternative Approaches:

- **Alternative 1: Pumba (Docker-Level Network/State Chaos):**
  - _Why was it rejected?_ Pumba is excellent at creating packet loss with `netem` or issuing SIGKILLs at the container level. However, Pumba requires high privileges (`--cap-add=NET_ADMIN` or `SYS_ADMIN`) in CI environments and local machines. Our focus is not network crashes, but validating that the system remains **Fail-Open** during Thread Pool Exhaustion and Disk I/O Blockage. Pumba is an infrastructural tool that is too "blind" to directly test Tracehound's internal consistency logic.
- **Alternative 2: Toxiproxy (L4 TCP/IP Chaos Injection):**
  - _Why was it rejected?_ Designed to intercept and drop/slow down connections at the L4 level. The defining characteristic of Tracehound's v2.0 architecture is ensuring data integrity on disk (AuditChain) and allowing the application to proceed without deadlocks. Toxiproxy cannot interact with or disrupt file system operations.

### Why the Chosen Solution is Not a Shortcut

The current script (spawning concurrent requests via Node.js and deterministically sabotaging mounted sink paths inside the container) does not just create random infrastructural errors. It tests the application's SLAs under deterministic conditions (e.g., "If the pool is completely exhausted, it times out after 100ms and the system remains healthy, returning HTTP 200/403"). This is not an environmental test; it is a **Domain-Specific Invariant Test**.

## 2. EFFORT JUSTIFICATION RULE

_"Why is this solution architecturally correct, rather than just being faster or easier to implement?"_

It is correct because **Tracehound is built on determinism, not randomness, as a security layer**. A tool that randomly kills containers cannot prove whether Tracehound reacts correctly within a fraction of a second at the boundaries of `POOL_SIZE=2` and `POOL_TIMEOUT_MS=100`. The deterministic flow you wrote provides the SecOps team with a mathematical sequence (Request Flood -> Wait -> Assert Status) that proves "The server continues to operate under all circumstances."

## 3. DEPENDENCY AWARENESS CONTRACT

This testing strategy impacts all system layers as follows (no "not affected" assumptions were made):

- **Data Model:** By replacing snapshot and trace-registry file targets with directories, it verifies fail-open behavior against deterministic local sink-write failures without relying on privileged host mutations.
- **API / Contract Surface:** The test verifies as an auditor whether the API responds according to expected contracts (HTTP 200/403) even under the most severe conditions, and whether opaque `x-tracehound-trace-id` output is present only when a request is actually quarantined.
- **Runtime Behavior:** The exhaustion and subsequent autonomous recovery of the thread pool is the runtime's most critical "Fail-Open" behavior. The test operates precisely on this surface.
- **Deployment / Operations:** By not requiring privileged permissions in CI/CD pipelines, it reduces security risks and setup costs to zero.
- **Observability (Logging, Metrics, Tracing):** The suite now also interrogates the local runtime endpoint for signed snapshot state, panic telemetry, and bounded trace-registry summaries. External log shipping and metrics export remain outside this test's scope.
- **Future Roadmap Impact:** If Tracehound migrates to different communication protocols (gRPC or UDS) in the future, this REST-focused script will need to be expanded; this reinvestment might not have been necessary if a generic tool had been used.

## 4. NO SILENT ASSUMPTIONS

**Explicit Assumptions:**

1. We assume that replacing a writable file target with a directory is an acceptably deterministic proxy for "local sink became non-writable" at the application layer.
2. We assume that the operating system's thread scheduling, combined with Node.js's asynchronous `Promise.all` structure, can emulate a true DoS/Flood attack with sufficient concurrency at the network layer.

**Unknowns:**

1. It is currently unknown how the application will behave if the file system experiences a complete "I/O Hang" (Linux `D` state) rather than instantly throwing an "EACCES" (permission denied) error.
2. It is unknown whether TCP connections will queue up at the operating system level and exceed File Descriptor limits during a 50% packet loss scenario.

## 5. SECOND-ORDER EFFECTS GATE

- **Positive Second-Order Effect:** Developers can run this test script locally on macOS/Windows without requiring any Linux kernel modifications. This ensures errors are caught early in the development lifecycle before reaching CI.
- **Negative Second-Order Effect:** The team might develop a blind spot by only testing software invariants. How a panic state at the operating system level (Kernel network stack) beneath Tracehound would impact the overall system architecture might be left unanalyzed.

## 6. FAILURE, ROLLBACK, AND BLAST RADIUS

- **Failure Modes:** A Docker Daemon lockup or the process inside the container becoming unresponsive during the test could leave the test script in a zombie (hanging) state.
- **Rollback Strategy:** The `docker compose down -v --remove-orphans` command executed in the `#Teardown` block at the end of the test tears down the runtime containers and network. Host-mounted chaos artifacts are intentionally preserved for operator inspection until the next suite start resets them.
- **Blast Radius:** Because the test runs in an isolated `docker-compose` network, there is a zero percent chance of it affecting other active test processes on the host machine or in the CI pipeline.

## 7. SELF-CRITIQUE REQUIREMENT

To win the trust of the SecOps team in Monday's meeting, they need to hear our weaknesses **from us**.

- **The weakest assumption in this solution:** Timing-based assertions. Although the suite now favors polling over fixed sleeps, the mixed-pressure latency budget is still environment-sensitive under extreme host contention.
- **The most fragile component:** The methodology of initiating chaos via REST API requests. If the system later implements rate-limiting protections that slow down or drop network requests, this test will break immediately.
- **Where will this structure fail first in the real world?** When Tracehound begins to be deployed as distributed nodes. Single-process and disk blockages will no longer be sufficient; when attempting to simulate Split-Brain scenarios across nodes, `run-chaos-suite.ts` will become inadequate, mandating a forced migration to Kubernetes-orchestrated chaos tools like Chaos Mesh.

---

_This document provides the necessary execution-grade argumentation to defend the Tracehound chaos testing suite as a deliberate, robust engineering decision._
