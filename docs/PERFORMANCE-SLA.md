# Performance Characteristics

> **Version:** 1.2
> **Status:** Descriptive
> **Applies to:** `@tracehound/core`

---

## Overview

This document describes the currently implemented performance model of Tracehound core. It is not a contractual latency SLA.

Published numbers in scenario tests are environment-dependent and should be read as current measurements, not fixed guarantees.

---

## Hot Path Scope

`agent.intercept()` is the synchronous hot path.

The following are intentionally outside that latency surface:

1. HoundPool analysis
2. Cold storage archival
3. Notification and webhook delivery
4. Snapshot disk export

---

## Current Design Characteristics

### Intercept path

The intercept path currently performs:

1. rate-limit checks
2. payload validation and encoding
3. deterministic hashing/signature generation
4. duplicate detection
5. bounded quarantine insert
6. audit chain append

### Data structure notes

These reflect the current implementation, including known hot spots:

1. Quarantine eviction is deterministic and priority-aware, with victim selection performed by deterministic bounded selection rather than full-store sorting.
2. Quarantine stats are exposed from maintained in-memory counters; snapshot reads no longer rescan the full store for severity totals or next expiry.
3. Rate limiter state is bounded, and timestamp pruning now compacts bounded per-source windows instead of allocating filtered arrays on each hot check.
4. Notification subscribers and webhook delivery are bounded and off the hot path.

---

## Memory Bounds

### Quarantine

| Metric          | Default            | Configurable |
| --------------- | ------------------ | ------------ |
| Max items       | 10,000             | Yes          |
| Max bytes       | 100MB              | Yes          |
| Eviction policy | Priority, then age | No           |

### Notification plane

| Surface                | Bound                     |
| ---------------------- | ------------------------- |
| Async subscriber queue | Fixed-size per subscriber |
| Webhook backlog        | Fixed-size queue          |
| Webhook inflight work  | Fixed concurrency cap     |

Bounded does not mean lossless. Under pressure, Tracehound may drop queued notification work to preserve host stability.

---

## Measurement Guidance

For current measured values, use the repository scenario suite instead of this document:

1. `packages/core/scenarios/stress.test.ts`
2. `packages/core/scenarios/cold-storage-pipeline.test.ts`
3. `packages/core/scenarios/ipc-stress.test.ts`
4. `packages/core/scenarios/async-codec-stress.test.ts`

These tests print observed throughput and latency during execution.

---

## What This Document Does Not Promise

This document does not currently promise:

1. fixed p50 or p99 latency targets across environments
2. constant-time eviction across total quarantine size
3. unlimited worker capacity
4. lossless downstream delivery under sink failure

---

## Related Documents

- [FAIL-OPEN-SPEC.md](./FAIL-OPEN-SPEC.md)
- [CRITICAL-SECURITY-REMEDIATION-PLAN.md](./CRITICAL-SECURITY-REMEDIATION-PLAN.md)
