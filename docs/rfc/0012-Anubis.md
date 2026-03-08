# RFC-0012: Anubis — Post-Mortem Forensic Pipeline

## Metadata

| Field            | Value                                                      |
| ---------------- | ---------------------------------------------------------- |
| Status           | Draft                                                      |
| Security Impact  | Medium (offline evidence processing, no runtime authority) |
| Operational Risk | Low (out-of-band, batch processing)                        |
| Dependencies     | RFC-0000 (Core), RFC-0004 (Muninn)                         |
| Tier             | Control-Based ($99/mo)                                     |
| Author           | -                                                          |
| Created          | 2026-03-04                                                 |

---

## Motivation

Tracehound Core processes threats **in real-time** during the request lifecycle. This imposes a fundamental constraint:

> Evidence exists only for requests intercepted by a running Tracehound instance.

In practice, organizations face three scenarios where real-time capture is insufficient:

1. **Pre-deployment Gap**: Tracehound was not installed when the incident occurred. WAF/SIEM logs exist but lack forensic chain integrity.
2. **Multi-source Reconstruction**: A breach investigation requires correlating logs from WAF, SIEM, RASP, and multiple application instances into a single evidence timeline.
3. **Retroactive Compliance**: An auditor requests evidence chains for a period _before_ Tracehound was deployed. Existing logs must be ingested and sealed retroactively.

```
                    Real-time                    Post-mortem
                    ─────────                    ───────────
Tracehound Core:    ✅ Request → Evidence        ❌ Not its job
Muninn:             ✅ Threat metadata            ❌ Not its job
Anubis:             ❌ Not its job                ✅ Logs → Evidence Chain
```

**Anubis completes the temporal coverage gap.** It transforms dead logs into living evidence chains.

---

## Core Principle: The Weighing of the Heart

> In Egyptian mythology, Anubis weighs the heart of the deceased against the feather of Ma'at (truth). The soul's fate depends on the result.

Anubis weighs existing logs against **Tracehound's evidence standard** (TEF — Tracehound Evidence Format). Logs that pass normalization and chain insertion become admissible evidence. Logs that fail are flagged with integrity warnings.

**Anubis does NOT:**

- Make threat detection decisions (decision-free principle)
- Modify or enrich source logs
- Operate in real-time or in-band
- Replace Tracehound Core's runtime pipeline

**Anubis DOES:**

- Normalize heterogeneous log formats into TEF
- Build Merkle chains from normalized evidence
- Apply Cryptographic Witness (RFC 3161 timestamps)
- Establish cross-source correlation via temporal proximity and correlation ID matching
- Archive sealed evidence to cold storage

---

## Non-Goals

- Real-time threat interception (Core's domain)
- Threat detection or classification (external concern)
- Log aggregation or search (SIEM's domain)
- Alert generation (Watcher's domain)
- Source log modification or enrichment
- Universal log format support (selective, score-based)

---

## Architecture

### System Context

```
┌─────────────────────────────────────────────────────────────────────┐
│                        A N U B I S                                  │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │  WAF Logs    │  │  SIEM Events │  │  RASP Alerts │             │
│  │  (Cloudflare,│  │  (Splunk,    │  │  (Contrast,  │             │
│  │   AWS WAF,   │  │   Elastic,   │  │   Sqreen,    │             │
│  │   Fastly)    │  │   Datadog)   │  │   Imperva)   │             │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘             │
│         │                 │                  │                      │
│         └─────────────────┼──────────────────┘                      │
│                           ▼                                         │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  CONNECTOR LAYER                                           │    │
│  │  Selective support: popularity + reliability score          │    │
│  │  MVP: JSON (generic) + CEF (ArcSight/QRadar)              │    │
│  └────────────────────────────┬───────────────────────────────┘    │
│                               ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  NORMALIZATION ENGINE                                      │    │
│  │  Source format → Tracehound Evidence Format (TEF)          │    │
│  │                                                            │    │
│  │  Stages:                                                   │    │
│  │  1. Parse (format-specific connector)                      │    │
│  │  2. Map (field mapping to TEF schema)                      │    │
│  │  3. Validate (required fields, type checking)              │    │
│  │  4. Enrich (add processing metadata, NOT log mutation)     │    │
│  └────────────────────────────┬───────────────────────────────┘    │
│                               ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  CORRELATION ENGINE                                        │    │
│  │                                                            │    │
│  │  Strategy 1: Explicit — correlation ID field matching      │    │
│  │  Strategy 2: Temporal — ±Δt proximity window (configurable)│    │
│  │  Strategy 3: Source   — same source IP/identifier grouping │    │
│  │                                                            │    │
│  │  Output: CorrelationCluster[]                              │    │
│  └────────────────────────────┬───────────────────────────────┘    │
│                               ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  CHAIN BUILDER                                             │    │
│  │                                                            │    │
│  │  1. Sort by timestamp (deterministic ordering)             │    │
│  │  2. Build Merkle chain (SHA-256, identical to AuditChain)  │    │
│  │  3. Anchor via Cryptographic Witness (RFC 3161 TSA)        │    │
│  │  4. Generate chain manifest (summary + integrity proof)    │    │
│  └────────────────────────────┬───────────────────────────────┘    │
│                               ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  COLD ARCHIVE                                              │    │
│  │                                                            │    │
│  │  Storage: S3 / R2 / GCS (configurable)                    │    │
│  │  Transport: mTLS                                           │    │
│  │  Encryption: AES-256 at rest                               │    │
│  │  Retention: Policy-driven (configurable per chain)         │    │
│  │  Erasure: GDPR-compliant deletion API                      │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Integration with Tracehound Ecosystem

```
Tracehound Core (real-time)
       │
       │ AuditChain export
       ▼
    Anubis ◄──── WAF/SIEM/RASP logs
       │
       │ Unified evidence chains
       ▼
    Cold Archive
       │
       │ telemetry
       ▼
    Watchtower (FRS dashboard)
```

Anubis can ingest **both** Tracehound Core's exported AuditChain records **and** external log sources, merging them into a single unified evidence timeline.

---

## Type Definitions

### Tracehound Evidence Format (TEF)

The normalized output type. All connector outputs converge to this schema.

```ts
interface TEFRecord {
  /** Unique record identifier (generated by Anubis) */
  id: string

  /** Original source system identifier */
  sourceSystem: string

  /** Source connector type */
  connector: ConnectorType

  /** Original log entry identifier (if available) */
  sourceId?: string

  // ── Temporal ──

  /** Original event timestamp (epoch ms) */
  eventTimestamp: number

  /** Anubis ingestion timestamp (epoch ms) */
  ingestTimestamp: number

  // ── Classification ──

  /** Threat category (mapped from source) */
  category?: ThreatCategory

  /** Severity (mapped from source) */
  severity?: Severity

  // ── Correlation ──

  /** Correlation identifier (extracted from source or generated) */
  correlationId?: string

  /** Source identifier (IP, user, service) */
  source?: string

  /** Session identifier (if available) */
  sessionId?: string

  // ── Payload ──

  /** Normalized payload hash (SHA-256) */
  payloadHash: string

  /** Payload size in bytes */
  payloadSize: number

  /** Original payload (configurable: include or hash-only) */
  payload?: unknown

  // ── Metadata ──

  /** Processing metadata (added by Anubis, NOT source mutation) */
  processing: {
    connector: string
    connectorVersion: string
    normalizationStatus: 'full' | 'partial' | 'lossy'
    fieldsMapped: number
    fieldsDropped: number
  }

  /** Integrity */
  hash: string
}

type ConnectorType = 'json' | 'cef' | 'leef' | 'syslog' | 'tracehound-export'
```

### Connector Interface

```ts
interface AnubisConnector {
  /** Connector identifier */
  readonly type: ConnectorType

  /** Human-readable name */
  readonly name: string

  /** Supported source format version(s) */
  readonly supportedVersions: string[]

  /**
   * Parse a single log entry into a TEFRecord.
   *
   * MUST be pure (no side effects).
   * MUST NOT throw — return ParseFailure on error.
   */
  parse(raw: string | Buffer): ParseResult

  /**
   * Detect if a raw log entry matches this connector.
   * Used for auto-detection when connector is not specified.
   */
  detect(raw: string | Buffer): boolean
}

type ParseResult = { ok: true; record: TEFRecord } | { ok: false; error: ParseFailure }

interface ParseFailure {
  connector: string
  reason: string
  raw: string | Buffer
  timestamp: number
}
```

### Correlation Cluster

```ts
interface CorrelationCluster {
  /** Cluster identifier */
  id: string

  /** Correlation strategy that produced this cluster */
  strategy: 'explicit' | 'temporal' | 'source'

  /** Confidence score (0.0 - 1.0) */
  confidence: number

  /** Records in this cluster, ordered by eventTimestamp */
  records: TEFRecord[]

  /** Cluster metadata */
  metadata: {
    /** Unique sources in this cluster */
    uniqueSources: number
    /** Time span of cluster (ms) */
    timespan: number
    /** Dominant severity */
    dominantSeverity: Severity
    /** Dominant category */
    dominantCategory: ThreatCategory
  }
}
```

### Chain Manifest

```ts
interface ChainManifest {
  /** Manifest identifier */
  id: string

  /** Chain version */
  version: 1

  /** Creation timestamp */
  created: number

  /** Chain statistics */
  stats: {
    totalRecords: number
    sources: string[]
    connectors: ConnectorType[]
    timeRange: { start: number; end: number }
    clusters: number
    parseFailures: number
  }

  /** Merkle chain root hash */
  rootHash: string

  /** Cryptographic Witness token (RFC 3161) */
  witnessToken?: string

  /** Chain integrity proof */
  proof: {
    algorithm: 'sha256'
    chainLength: number
    genesisHash: string
    rootHash: string
  }
}
```

---

## Configuration

```ts
interface AnubisConfig {
  // ── Connectors ──

  /** Enabled connectors (order = auto-detection priority) */
  connectors: ConnectorType[]

  /** Custom connector implementations */
  customConnectors?: AnubisConnector[]

  // ── Normalization ──

  normalization: {
    /** Include original payload in TEFRecord (default: false, hash-only) */
    includePayload: boolean

    /** Maximum payload size to include (bytes, default: 64KB) */
    maxPayloadSize: number

    /** PII tokenization strategy */
    piiStrategy: 'none' | 'hash' | 'redact'
  }

  // ── Correlation ──

  correlation: {
    /** Enabled strategies (order = priority) */
    strategies: ('explicit' | 'temporal' | 'source')[]

    /** Temporal proximity window (ms, default: 5000) */
    temporalWindow: number

    /** Minimum cluster size to emit (default: 2) */
    minClusterSize: number

    /** Maximum cluster size (bound, default: 1000) */
    maxClusterSize: number
  }

  // ── Chain Building ──

  chain: {
    /** HMAC secret for chain integrity (optional) */
    hmacSecret?: string

    /** Cryptographic Witness settings */
    witness: {
      enabled: boolean
      provider: 'freetsa' | 'digicert' | 'custom'
      endpoint?: string // for custom provider
    }
  }

  // ── Storage ──

  storage: {
    /** Storage backend */
    backend: 's3' | 'r2' | 'gcs' | 'local'

    /** Backend-specific configuration */
    config: Record<string, unknown>

    /** Retention policy */
    retention: {
      defaultDays: number // default: 90
      maxDays: number // default: 365
    }

    /** Encryption at rest */
    encryption: {
      algorithm: 'aes-256-gcm'
      keySource: 'env' | 'kms' | 'vault'
    }
  }

  // ── Processing ──

  processing: {
    /** Batch size for ingestion (default: 100) */
    batchSize: number

    /** Maximum concurrent batches (default: 4) */
    concurrency: number

    /** Parse failure handling */
    onParseFailure: 'skip' | 'quarantine' | 'abort'
  }
}
```

---

## Behavior

### Ingestion Flow

```ts
// 1. Read log source
const rawLogs = await source.read()

// 2. Parse via connector
const results = rawLogs.map((raw) => {
  const connector = anubis.detectConnector(raw) ?? anubis.defaultConnector
  return connector.parse(raw)
})

// 3. Separate successes and failures
const records = results.filter((r) => r.ok).map((r) => r.record)
const failures = results.filter((r) => !r.ok).map((r) => r.error)

// 4. Correlate
const clusters = anubis.correlate(records)

// 5. Build chain
const chain = anubis.buildChain(records, clusters)

// 6. Witness (async, out-of-band)
if (config.chain.witness.enabled) {
  await anubis.witness(chain)
}

// 7. Archive
await anubis.archive(chain)

// 8. Emit manifest
const manifest = anubis.manifest(chain)
```

### Connector Selection Philosophy

Anubis does NOT aim for universal log format support. Connector support is **selective** based on:

| Criteria             | Weight | Description                                    |
| -------------------- | ------ | ---------------------------------------------- |
| **Market Share**     | 40%    | How many enterprises use this?                 |
| **Data Quality**     | 30%    | How structured/parseable is the format?        |
| **Forensic Value**   | 20%    | How much forensic-relevant data does it carry? |
| **Maintenance Cost** | 10%    | How stable is the format specification?        |

**MVP Connectors:**

| Connector                   | Score | Justification                                         |
| --------------------------- | :---: | ----------------------------------------------------- |
| `json` (generic)            |  95   | Universal, zero-maintenance, maximum flexibility      |
| `cef` (Common Event Format) |  88   | ArcSight, QRadar, many SIEMs — well-specified, stable |
| `tracehound-export`         |  100  | First-party, zero mapping loss, perfect fidelity      |

**Phase 2 Candidates:**

| Connector                          | Score | Justification                                   |
| ---------------------------------- | :---: | ----------------------------------------------- |
| `leef` (Log Event Extended Format) |  75   | IBM QRadar native — large enterprise adoption   |
| `syslog` (RFC 5424)                |  70   | Universal but low forensic value (unstructured) |
| `ecs` (Elastic Common Schema)      |  80   | Growing adoption, well-structured               |

**Community connectors:** Third-party connectors can be contributed via the `customConnectors` config.

---

## Correlation Strategies

### Strategy 1: Explicit (Highest Confidence)

Match records by explicit correlation identifiers found in source logs.

```
Record A: { correlationId: "txn-abc-123", source: "1.2.3.4" }
Record B: { correlationId: "txn-abc-123", source: "1.2.3.4" }
Record C: { correlationId: "txn-abc-123", source: "5.6.7.8" }

→ Cluster { id: "...", strategy: "explicit", confidence: 1.0, records: [A, B, C] }
```

Confidence: **1.0** (deterministic match).

### Strategy 2: Temporal (Medium Confidence)

Group records within a configurable time window from the same source.

```
Record A: { source: "1.2.3.4", eventTimestamp: 1000 }
Record B: { source: "1.2.3.4", eventTimestamp: 3500 }  // within 5s window
Record C: { source: "1.2.3.4", eventTimestamp: 12000 } // outside window

→ Cluster { strategy: "temporal", confidence: 0.7, records: [A, B] }
→ Record C: unclustered
```

Confidence: **0.5 - 0.8** (based on temporal proximity tightness).

### Strategy 3: Source (Lower Confidence)

Group all records from the same source identifier, regardless of timing.

```
All records from source "1.2.3.4" over a 24-hour window

→ Cluster { strategy: "source", confidence: 0.3, records: [...] }
```

Confidence: **0.2 - 0.4** (same IP ≠ same actor, NAT/proxy risk).

---

## Differences from Tracehound Core

| Dimension               |        Tracehound Core        |                Anubis                |
| ----------------------- | :---------------------------: | :----------------------------------: |
| **Timing**              | Real-time (request lifecycle) |        Batch (post-incident)         |
| **Source**              |    Single (own intercept)     | Multi (WAF, SIEM, RASP, Core export) |
| **Placement**           |     In-process or Daemon      |          Always out-of-band          |
| **Decision**            |       Quarantine / Pass       |    None — evidence archival only     |
| **Data**                |         Live traffic          |         Dead/historical logs         |
| **Latency requirement** |           p99 < 2ms           |         None (batch, async)          |
| **Memory model**        |  Bounded, real-time eviction  |        Streaming, disk-backed        |

---

## Integration with Satellites

### Muninn (RFC-0004)

Anubis can ingest Muninn's cold layer (NDJSON) and archive layer as input sources. The `tracehound-export` connector handles both.

```
Muninn Cold Layer (.ndjson) → Anubis → Sealed Evidence Chain
```

### Cryptographic Witness

Anubis reuses the same RFC 3161 anchoring mechanism specified for Tracehound Core's Rust pivot. Chain manifests include the witness token for legal admissibility.

### Watchtower

Anubis emits telemetry that feeds Watchtower's FRS (Forensic Readiness Score):

- Number of sealed chains
- Coverage (sources ingested vs total available)
- Archive health (encryption, retention compliance)
- Parse failure rate

---

## Performance

| Metric               | Target                        | Notes                                       |
| -------------------- | ----------------------------- | ------------------------------------------- |
| Ingestion throughput | > 10,000 records/sec          | Batch processing, no latency requirement    |
| Parse failure rate   | < 1% for supported connectors | MVP connectors only                         |
| Correlation latency  | < 5 sec for 100K records      | Single-pass algorithms                      |
| Archive write        | Async, non-blocking           | S3 multipart upload                         |
| Memory ceiling       | < 512MB for 1M record batch   | Streaming pipeline, no full-batch in memory |

---

## Security Considerations

| Concern                        | Mitigation                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| Log tampering before ingestion | Anubis documents source integrity status; chain proves post-ingestion integrity only |
| PII in source logs             | Configurable tokenization (hash/redact) before chain insertion                       |
| Archive key compromise         | KMS/Vault key rotation, per-chain encryption keys                                    |
| Parse failure exploitation     | Parse failures quarantined, never silently dropped                                   |
| Connector supply chain         | Only first-party connectors in MVP; third-party via explicit config                  |

---

## Risks & Mitigations

| Risk                                       | Probability | Impact | Mitigation                                                                                          |
| ------------------------------------------ | :---------: | :----: | --------------------------------------------------------------------------------------------------- |
| Connector sprawl (maintenance burden)      |    High     | Medium | Score-based selection, community contributions for niche formats                                    |
| Source log format drift (breaking changes) |   Medium    | Medium | Version pinning, degradation to `json` fallback                                                     |
| Retroactive evidence legal admissibility   |   Medium    |  High  | RFC 3161 timestamps prove _processing time_, not _event time_ — document this limitation explicitly |
| Storage cost escalation                    |     Low     | Medium | Retention policies, compression (gzip/brotli), lifecycle rules                                      |
| Correlation false positives                |   Medium    |  Low   | Confidence scoring, minimum cluster size, strategy transparency                                     |

---

## Scope

### Phase 1 (MVP)

1. `json` and `cef` connectors
2. Normalization engine (TEF output)
3. Temporal + explicit correlation
4. Merkle chain builder (AuditChain-compatible)
5. Local storage backend
6. Chain manifest generation

### Phase 2

7. S3/R2/GCS storage backends
8. Cryptographic Witness (RFC 3161)
9. `tracehound-export` connector
10. GDPR erasure API

### Phase 3

11. `leef` and `ecs` connectors
12. Watchtower telemetry integration
13. Custom connector SDK
14. Chain merge (combine multiple chains)

---

**Status: DRAFT**

Full implementation pending satellite development phase (post Loki, parallel with Norns/Furies).
