# RFC-0008: Tracehound Rust Core Pivot

> **Status:** Approved
> **Author:** Cluster.127
> **Created:** 2026-01-23
> **Target Version:** v2.0.0

## Abstract

Complete rewrite of Tracehound's core logic from TypeScript to Rust, enabling multi-runtime deployment through three distinct modes: embedded library (napi-rs), standalone daemon (gRPC/UDS), and transparent proxy.

---

## Motivation

### Current State

- TypeScript monorepo (v1.1.0 Stable)
- 368+ tests, production-ready
- Node.js-only ecosystem

### Target Markets (Revenue Priority)

| Segment         | Languages          | Node.js Relevance |
| --------------- | ------------------ | ----------------- |
| Fintech Core    | Java, C#, Go, Rust | ❌ Gateway only   |
| HealthTech      | Java, C#, Python   | ❌ Rarely         |
| Trading/Crypto  | Rust, C++, Go      | ❌ Never          |
| Enterprise SaaS | Java, C#, Go       | ⚠️ BFF layer      |

**Conclusion:** TypeScript-only limits addressable market to ~20% of security budget.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     TRACEHOUND CORE (Rust)                          │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  AuditChain (Merkle) │ Quarantine Buffer │ Evidence Ledger    │ │
│  │  SecureID Generator  │ HMAC Signatures   │ Scent Processing   │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                │                                    │
│         ┌──────────────────────┼──────────────────────┐             │
│         ▼                      ▼                      ▼             │
│  ┌─────────────┐       ┌─────────────────┐    ┌─────────────────┐   │
│  │   C ABI     │       │  Daemon Mode    │    │  Proxy Mode     │   │
│  │  Export     │       │ (gRPC over UDS) │    │ (HTTP Reverse)  │   │
│  └─────────────┘       └─────────────────┘    └─────────────────┘   │
└────────┬───────────────────────┬──────────────────────┬─────────────┘
         │                       │                      │
         ▼                       ▼                      ▼
┌─────────────────┐     ┌─────────────────┐    ┌────────────────────┐
│   libtracehound │     │   tracehoundd   │    │  tracehound-proxy  │
│   .so / .dll    │     │   (daemon)      │    │  (reverse proxy)   │
└────────┬────────┘     └────────┬────────┘    └────────┬───────────┘
         │                       │                      │
         ▼                       ▼                      ▼
┌─────────────────┐     ┌─────────────────┐    ┌────────────────────┐
│  Node.js SDK    │     │  Go/C#/Java     │    │  Any Protocol      │
│  (napi-rs)      │     │  (gRPC clients) │    │  (Zero-code)       │
└─────────────────┘     └─────────────────┘    └────────────────────┘
```

---

## Key Decisions

### 1. TLS Termination (Proxy Mode)

> ⚠️ **CRITICAL:** Tracehound **MUST** terminate TLS to inspect payloads.

**Strategy:**

- Default: HTTP (assume upstream ALB/Nginx terminates TLS)
- Optional: TLS termination with configurable certificates
- Never: TLS passthrough (defeats purpose)

**Roadmap:** PKCS#11 / Vault integration for HSM key management (v2.2.0+)

### 2. IPC Protocol

| Context                | Protocol                  | Rationale                                    |
| ---------------------- | ------------------------- | -------------------------------------------- |
| External (SDK→Daemon)  | gRPC over UDS/Named Pipes | Schema, codegen, enterprise standard         |
| Internal (Cluster.127) | C127 Binary               | Zero-copy, length-prefixed, ecosystem-native |

> ⚠️ **Windows:** Named Pipes required. Use `interprocess` crate abstraction.

### 3. Hot Reload

> ⛔ **CRITICAL:** Restart-based config update is **unacceptable** in fintech.

**Implementation:**

```rust
use arc_swap::ArcSwap;

static CONFIG: Lazy<ArcSwap<Config>> = Lazy::new(|| {
    ArcSwap::from_pointee(Config::load())
});

fn reload_config() {
    let new_config = Config::load();
    CONFIG.store(Arc::new(new_config));
    // Zero downtime, atomic swap
}
```

### 4. Multi-Instance Sync

| Mode            | Strategy                                         |
| --------------- | ------------------------------------------------ |
| Single Instance | In-memory HashMap                                |
| Cluster Mode    | Redis L2 + Local L1 cache + Pub/Sub invalidation |

### 5. FFI Panic Safety

> ⛔ **CRITICAL:** FFI panic = host process abort.

**Mandate:** Every exported function MUST use `std::panic::catch_unwind` and return safe error codes. Never crash the host.

---

## Deployment Modes

### Mode 1: Library (napi-rs)

**Target:** Node.js applications
**Latency:** ~0 (in-process)
**Integration:** `npm install @tracehound/core`

```typescript
import { createTracehound } from '@tracehound/core'
const th = createTracehound({
  /* config */
})
const result = th.intercept(scent)
```

### Mode 2: Daemon (tracehoundd)

**Target:** Go, Java, C#, Python
**Latency:** +100-300µs (UDS IPC)
**Integration:** gRPC client

```go
conn, _ := grpc.Dial("unix:///var/run/tracehound.sock")
client := pb.NewTracehoundClient(conn)
result, _ := client.Intercept(ctx, &pb.Scent{...})
```

### Mode 3: Proxy (tracehound-proxy) — v2.1.0 Beta

**Target:** Any protocol, zero-code
**Latency:** +500µs-2ms (full request inspection)
**Status:** Deferred to v2.1.0 as Beta

---

## Workspace Structure

```
tracehound/
├── Cargo.toml              # Workspace root
├── crates/
│   ├── core/               # Business logic (AuditChain, Quarantine, SecureID)
│   ├── ffi/                # C ABI exports (libtracehound.so/dll)
│   ├── daemon/             # gRPC server, hot reload, Redis adapter
│   └── proxy/              # HTTP reverse proxy (v2.1.0)
├── packages/
│   ├── core-rs/            # napi-rs bindings
│   └── core/               # Thin wrapper (backward compat)
└── proto/
    └── tracehound.proto    # gRPC service definition
```

---

## Recommended Crates

| Purpose              | Crate                           |
| -------------------- | ------------------------------- |
| Async Runtime        | `tokio`                         |
| HTTP/Proxy           | `hyper`, `tower`, `axum`        |
| gRPC                 | `tonic`                         |
| Config               | `config-rs`                     |
| FFI                  | `safer-ffi`                     |
| Hot Reload           | `arc-swap`                      |
| IPC (Cross-platform) | `interprocess`                  |
| Tracing              | `tracing`, `tracing-subscriber` |

---

## Timeline

| Phase            | Duration | Deliverable                                | Status      |
| ---------------- | -------- | ------------------------------------------ | ----------- |
| Phase 1: Core    | 4 weeks  | `crates/core`, `crates/ffi`, libtracehound | Pending     |
| Phase 2: Node.js | 2 weeks  | `packages/core-rs`, napi-rs bindings       | Pending     |
| Phase 3: Daemon  | 3 weeks  | `tracehoundd`, gRPC/UDS, hot reload        | Pending     |
| Phase 4: Proxy   | 2 weeks  | `tracehound-proxy`                         | v2.1.0 Beta |
| Phase 5: SDKs    | 2 weeks  | Go, C#, Python thin clients                | Pending     |

**Total Core (v2.0.0):** ~9 weeks
**Including Proxy Beta:** ~11 weeks

---

## Risks & Mitigations

| Risk                      | Impact       | Mitigation                       |
| ------------------------- | ------------ | -------------------------------- |
| FFI boundary panics       | **Critical** | `catch_unwind` on ALL exports    |
| Version skew (lib/daemon) | Medium       | Embedded version check protocol  |
| Windows IPC               | High         | `interprocess` crate abstraction |
| Redis SPOF                | High         | Redis Sentinel / Cluster support |
| TLS key exposure          | High         | PKCS#11 / Vault roadmap          |

---

## Breaking Changes

> ⚠️ Node.js SDK API surface remains **identical**, but underlying implementation changes.

- `@tracehound/core` v2.0.0 will require native binary download
- Existing unit tests should pass without modification
- Runtime behavior is **bit-compatible** (same outputs for same inputs)

---

## Approval

- [x] RFC reviewed by SecOps
- [x] Technical architecture approved
- [ ] Rust workspace scaffolding
- [ ] Implementation begins

**Decision:** GO 🚀
