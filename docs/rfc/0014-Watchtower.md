# RFC-0014: Watchtower — Enterprise Control Plane

## Title and Metadata

| Field | Value |
| --- | --- |
| RFC | 0014 |
| Status | Draft |
| Author | Tracehound Engineering |
| Created | 2026-03-07 |
| Updated | 2026-03-07 |
| Depends on | RFC-0000, RFC-0010, RFC-0011, RFC-0013 |
| Supersedes | None |
| Implemented in | `@tracehound/watchtower` (enterprise fork only) |
| Tier | $299/mo |

## Motivation

TraceHound OSS core is decision-free, fail-open, and deliberately headless. This is correct for the data plane. However, operating TraceHound at enterprise scale — across multiple instances, teams, and compliance regimes — requires a control plane: a single surface where policy is authored, telemetry is aggregated, modules are managed, and incidents are acted upon.

Problems addressed:

1. No unified surface for configuring thresholds, retention policy, and escalation rules across instances.
2. No visibility layer: pressure state, chain integrity, coverage ratio, and FRS primitives are emitted by core but consumed by nothing.
3. No lifecycle management for satellite modules — install, activate, and uninstall require manual npm operations and config edits.
4. No billing or subscription surface: customers must visit an external site to manage modules.
5. No incident response capability: quarantined evidence has no workflow (archive, escalate, dismiss, export).

Watchtower closes all five gaps without touching the OSS core. Every capability is additive.

## Design

### 1. Position

```text
[OSS Core — unchanged]          [Watchtower — enterprise only]
  Agent (hot path)        ←IPC→   Control Plane Hub
  AuditChain                        Policy store
  Quarantine / HoundPool            Telemetry aggregator
  Pressure state machine            Module registry client
  RFC-0013 signed snapshots         Incident workflow
  RFC-0010 one-way membrane         Billing & subscription
  RFC-0011 pressure containment     Module catalog
```

Watchtower is not in the request path. It connects to core via an out-of-band IPC channel. Core degradation or Watchtower unavailability are independent failure domains.

### 2. Core ↔ Watchtower IPC Contract

The IPC boundary is defined by two unidirectional channels:

**Telemetry channel (Core → Watchtower, push):**

```ts
interface CoreTelemetryFrame {
  readonly instanceId: string
  readonly timestamp: number
  readonly pressureState: 'normal' | 'elevated' | 'critical'
  readonly quarantineDepth: number
  readonly auditChain: {
    readonly totalRecords: number
    readonly lastVerifiedAt: number | null
    readonly integrityOk: boolean
  }
  readonly readiness: {
    readonly coverageRatio: number        // RFC-0013 primitive
    readonly retentionCompliant: boolean  // RFC-0013 primitive
    readonly coldStorageSync: 'healthy' | 'degraded' | 'failed'
  }
  readonly activeModules: ReadonlyArray<string>
}
```

**Config channel (Watchtower → Core, push on change):**

```ts
interface CoreConfigPush {
  readonly version: number              // monotonic, core rejects stale pushes
  readonly quarantineThreshold: number
  readonly pressureLimits: {
    readonly elevatedAt: number
    readonly criticalAt: number
  }
  readonly retentionPolicy: {
    readonly hotTtlMs: number
    readonly coldTtlMs: number
  }
  readonly blocklist: ReadonlyArray<string>
  readonly escalationRules: ReadonlyArray<EscalationRule>
}
```

**Behavioral rules:**

1. Watchtower unavailability: core continues on last committed config. No fail-closed behavior.
2. Config push rejected if `version` is not monotonically greater than current.
3. Telemetry push is fire-and-forget from core's perspective. Backpressure is Watchtower's concern.
4. Payload bytes never cross the IPC boundary. RFC-0010 one-way membrane is preserved end-to-end.

### 3. IPC Bridge (`@tracehound/watchtower-bridge`)

The bridge is an enterprise-only in-process package. It runs alongside core inside the host application process — no daemon, no separate process.

**Setup:**

```ts
import { createWatchtowerBridge } from '@tracehound/watchtower-bridge'

const bridge = createWatchtowerBridge(tracehound, {
  watchtowerUrl: 'http://localhost:7474',
  secret: process.env.TRACEHOUND_SNAPSHOT_SECRET,
})
await bridge.start()
```

**Bridge responsibilities:**

| Direction | Mechanism | Description |
| --- | --- | --- |
| Core → Watchtower (events) | `NotificationEmitter` subscription | Quarantine events, pressure transitions, chain integrity alerts forwarded via HTTP POST |
| Core → Watchtower (telemetry) | RFC-0013 snapshot polling | Bridge reads signed snapshot on `intervalMs` cadence, constructs `CoreTelemetryFrame`, sends to Watchtower |
| Watchtower → Core (config) | WebSocket push | Watchtower pushes `CoreConfigPush` to bridge connection; bridge calls `tracehound.reconfigure(config)` |

**Design constraints:**

- `@tracehound/core` is not modified. Bridge subscribes to the existing `NotificationEmitter` — no new hooks in core.
- Bridge connection loss is non-fatal: events are dropped (not buffered), telemetry polling resumes on reconnect.
- Only one bridge connection per core instance. Multiple Watchtower connections to the same instance are rejected.

### 4. Config Hot-Reload

The enterprise fork extends the `ITracehound` public API with `reconfigure()`:

```ts
interface ITracehound {
  // existing members unchanged...
  reconfigure(config: CoreConfigPush): Promise<void>
}
```

**Behavior:**

- Soft config (thresholds, blocklist, escalation rules, retention policy) is applied in-place — no host app restart, no Tracehound instance recreation.
- `config.version` is verified monotonically before applying. Stale pushes are rejected silently.
- In-flight requests are unaffected. New config takes effect for subsequent intercepts only.
- Non-soft changes (e.g., snapshot path, secret rotation) are not supported via `reconfigure()` and require instance restart. Unsupported fields in the push are ignored.

**Rust pivot:** arc-swap enables atomic hot-reload without async coordination or version gating overhead. The `reconfigure()` contract is preserved; implementation switches from async lock to arc-swap internally.

### 5. Evidence Query API

Watchtower may query evidence metadata for display in the Evidence Inspector. Payload bytes are never returned.

```ts
interface EvidenceQuery {
  readonly traceId: string
}

interface EvidenceMetadata {
  readonly traceId: string
  readonly source: string
  readonly timestamp: number
  readonly severity: string
  readonly chainPosition: number
  readonly chainHash: string
  // payload: never — one-way membrane enforced at query layer
}
```

### 4. Module Plugin Contract

Every satellite module that integrates with Watchtower implements `WatchtowerModule`:

```ts
interface WatchtowerModule {
  readonly moduleId: string
  readonly displayName: string
  readonly version: string
  readonly integrationMode: 'auto' | 'manual'

  // Lifecycle
  register(context: WatchtowerContext): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
  health(): ModuleHealth

  // UI contributions (optional)
  dashboardPanels?(): ReadonlyArray<PanelDescriptor>
  configSchema?(): JSONSchema

  // Telemetry contributions (optional)
  telemetryStream?(): AsyncIterable<ModuleTelemetryFrame>
}

interface ModuleHealth {
  readonly status: 'healthy' | 'degraded' | 'inactive'
  readonly message?: string
}
```

`integrationMode`:

- `'auto'` — module hooks into runtime without user code changes (e.g., Argos).
- `'manual'` — module requires user to add imports or config; documentation is shown post-activation.

### 5. Module Catalog

Watchtower includes a Modules page. Each available module is presented as a card:

```text
┌─────────────────────────────────────────┐
│  Huginn                                  │
│  Threat Intelligence Ledger              │
│                                          │
│  External aggregator — no integration    │
│  required.                               │
│                                          │
│  • Historical threat patterns            │
│  • Source reputation scoring             │
│  • Temporal burst detection              │
│                                          │
│  $49/mo                   [Add Module]   │
└─────────────────────────────────────────┘
```

Install flow:

```text
[Add Module] → [Downloading...] → [Activate]
                                      │
                          integrationMode === 'auto'
                                      │
                          ┌───────────┴────────────┐
                        'auto'                  'manual'
                      Activates,             Docs tab opens,
                     restarts hub          user follows steps,
                                           then [Activate]
```

Card content is synchronized with tracehoundlabs.com (same title, summary, and feature list). No separate site visit required for install.

**Uninstall flow:**

1. User initiates uninstall from module card.
2. Watchtower scans known integration points for module imports (static manifest check).
3. If dependent code is detected: warning shown with affected integration points.
4. On confirm: module stopped → UI panels removed → package unlinked → hub restarted.
5. Subscription line item removed; takes effect next billing cycle.

### 6. Hub Core Capabilities

These are always present regardless of which modules are installed:

| Capability | Description |
| --- | --- |
| Policy store | Persistent config for thresholds, retention, blocklist, escalation rules |
| Telemetry aggregator | Receives and stores `CoreTelemetryFrame` per instance |
| FRS dashboard | Forensic Readiness Score computed from readiness primitives |
| Quarantine viewer | Real-time event stream; severity filter; evidence inspector |
| AuditChain browser | Chain health, last N records, integrity violation alerts |
| Pressure indicator | Pressure state per instance (normal / elevated / critical) |
| Incident workflow | Per-evidence actions: archive, escalate to SIEM, dismiss, export |
| RBAC | Role-based access control; audit log of all Watchtower actions |
| Billing & subscription | Active modules, payment method, invoice history |

### 7. Policy Engine

Watchtower authors policy; core executes it deterministically. The core is never aware of "why" a threshold was set — it only sees the committed config.

**Escalation rule example:**

```ts
interface EscalationRule {
  readonly trigger: 'pressure_critical' | 'chain_integrity_violation' | 'quarantine_depth_exceeded'
  readonly action: 'webhook' | 'pagerduty' | 'slack' | 'siem_export'
  readonly target: string        // URL or channel
  readonly throttleMs: number    // minimum interval between triggers
}
```

**Blocklist enforcement:**

Blocklist entries are pushed to core via `CoreConfigPush`. Core applies them as deterministic quarantine rules — same fail-open semantics apply. Blocklist push failure does not interrupt host request flow.

### 8. Forensic Readiness Score (FRS)

FRS is Watchtower's composite score, computed from primitives emitted by core via `CoreTelemetryFrame.readiness`:

| Metric | Weight | Source |
| --- | --- | --- |
| Coverage ratio | 30% | `coverageRatio` from RFC-0013 |
| Retention compliance | 25% | `retentionCompliant` from RFC-0013 |
| Chain integrity | 25% | `auditChain.integrityOk` from AuditChain |
| Export capability | 20% | `coldStorageSync` + active export formats |

FRS is computed in Watchtower, never in core. Core emits raw primitives; scoring algorithm is a Watchtower concern and may evolve without core changes.

### 11. Multi-Instance Support

Phase 1 (MVP): single instance. Watchtower connects to one core agent.

Phase 3: Watchtower receives `CoreTelemetryFrame` from multiple instances (identified by `instanceId`). Dashboard shows per-instance panels and aggregate FRS. Policy pushes are broadcast to all registered instances.

Instance registration is coordinated via `packages/coordination` (RFC-0009 native implementation).

### 12. License Enforcement

Watchtower is commercial software distributed as a compiled binary. Protection is layered across three mechanisms.

#### Distribution Format

Watchtower server is distributed as a single self-contained executable via **Node.js SEA (Single Executable Application)**, built into Node.js 20+. The source is bundled and sealed inside the binary — direct file access is not possible without deliberate extraction effort. When the Rust server implementation is introduced, the native binary raises this bar further.

The frontend SPA is served by the Watchtower server process and contains no sensitive business logic. License validation is server-side only.

#### License Token (Offline JWT)

Each deployment is issued a signed license token at purchase:

```ts
interface LicenseToken {
  readonly orgId: string
  readonly instanceId: string        // machine fingerprint at activation time
  readonly tier: 'watchtower' | 'enterprise'
  readonly modules: ReadonlyArray<string>  // entitled module IDs
  readonly issuedAt: number
  readonly expiresAt: number
  readonly signature: string         // RS256, private key held by Tracehound
}
```

Token is verified on every startup:

```text
startup → read license file → verify RS256 signature
        → check expiresAt   → reject if expired (14-day grace period)
        → check instanceId  → reject if fingerprint mismatch
        → resolve modules   → only entitled modules available in catalog
```

Private key never leaves Tracehound infrastructure. A forged token requires private key compromise. Renewal is handled by issuing a new token; Watchtower checks for a refreshed license file on each startup.

**Air-gap support:** Offline JWT works without internet access. License renewal requires downloading a new token file (from tracehoundlabs.com or via support). No phone-home required during operation.

#### Binary Signing

All released Watchtower binaries are signed with Tracehound's code signing certificate:

- macOS: Developer ID Application (Gatekeeper notarization)
- Windows: Authenticode (SmartScreen recognition)
- Linux: GPG signature on release artifacts

Customers can verify binary authenticity before deployment. Tampering invalidates the signature.

#### Feature Gating

Module availability is resolved from the license token at startup. A module not listed in `token.modules` does not appear in the catalog and cannot be activated, regardless of whether its package is present on disk.

### 13. Phased Implementation

| Phase | Scope |
| --- | --- |
| MVP (Phase 1) | Hub core, single instance, quarantine viewer, chain browser, pressure indicator, FRS dashboard, policy config (thresholds + retention), IPC bridge to core |
| Phase 2 | Module catalog, install/activate/uninstall flow, billing surface, incident workflow (archive, dismiss, escalate) |
| Phase 3 | Multi-instance view, SIEM export integration, Anubis job triggers from incident workflow |
| Phase 4 | Dependency scanner on uninstall, module signature verification, advanced escalation rules |

## Security Considerations

1. **One-way membrane**: payload bytes never cross the IPC boundary or appear in any Watchtower response. Enforced at the query layer, not just by convention.
2. **Config versioning**: monotonic version on `CoreConfigPush` prevents replay attacks and stale config injection.
3. **Module signature verification**: Phase 4. Until then, modules are distributed via Tracehound's private registry only; no third-party modules.
4. **Watchtower auth**: RBAC enforced on all policy mutations and evidence queries. All mutations written to Watchtower's own audit log.
5. **IPC channel**: local-only or mTLS-secured for remote core instances. Plaintext IPC is not acceptable for remote connections.
6. **Blocklist poisoning**: blocklist entries are validated and bounded before push. Oversized or malformed entries are rejected; partial rejection does not block the push.
7. **Fail-open preservation**: Watchtower crash or network partition must never cause core to fail-closed. Core's last committed config is always the fallback.

## Performance Impact

1. Telemetry push is out-of-band and asynchronous. No impact on core hot path.
2. Config push is infrequent (operator-initiated or threshold-triggered). Not latency-sensitive.
3. Evidence query is metadata-only and served from core's read path, not the intercept path.
4. FRS computation runs in Watchtower process. No core CPU impact.
5. Module lifecycle operations (install, restart) are administrative actions. Not on request path.

## Backward Compatibility

1. OSS core is not modified by this RFC. All changes are additive in the enterprise fork.
2. `WatchtowerModule` interface is additive. Existing satellite RFC contracts (RFC-0002, RFC-0004, RFC-0012) are unchanged; Watchtower integration is an optional extension.
3. Deployments without Watchtower continue to operate identically. Watchtower is opt-in.
4. Core config format (`CoreConfigPush`) must remain backward-compatible across minor versions. Breaking changes require a new config version field.

## Test Plan

**Unit:**

1. `CoreConfigPush` version rejection for non-monotonic updates.
2. Evidence query returns no payload bytes under any input.
3. FRS computation from known primitive values.
4. Escalation rule throttle enforcement.
5. Module lifecycle transitions (register → start → stop → uninstall).

**Integration:**

1. Core with Watchtower unavailable at startup and at runtime — host request flow unaffected.
2. Policy push (blocklist + threshold) reflected in core behavior within one push cycle.
3. Telemetry frame received and FRS updated within expected interval.
4. Module install (auto mode): activation without user code changes.
5. Module install (manual mode): docs tab shown, activation blocked until user confirms.
6. Module uninstall with dependent integration: warning shown, uninstall blocked until confirmed.

**Security-negative:**

1. Evidence query response inspected for presence of payload bytes — must be absent.
2. Stale `CoreConfigPush` (lower version) rejected by core.
3. Watchtower process killed mid-push — core continues on previous config.
4. Oversized blocklist entry rejected without blocking rest of push.

## Alternatives Considered

1. **Embed Watchtower into OSS core as optional middleware.**
   Rejected. Violates OSS/enterprise boundary and forces commercial features into the open codebase.

2. **Separate standalone SaaS (cloud-hosted Watchtower).**
   Rejected for MVP. Enterprise customers require data-local deployment. Cloud-hosted option may be added post-traction as an additional tier.

3. **CLI-only control plane (extend `@tracehound/cli`).**
   Insufficient. Terminal output satisfies developer debugging but not SecOps operators, compliance teams, or multi-instance environments. CLI remains for local diagnostics; Watchtower is the enterprise surface.

4. **One config file per module (no central policy store).**
   Rejected. Distributed config creates policy drift across instances and makes compliance reporting unreliable.
