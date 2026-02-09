# RFC-0004: Muninn — Threat Metadata Substrate

## Metadata

| Field            | Value                                                |
| ---------------- | ---------------------------------------------------- |
| Status           | Draft                                                |
| Security Impact  | Low (non-authoritative)                              |
| Operational Risk | Low (bounded memory, fire-and-forget)                |
| Dependencies     | RFC-0000 (Core), RFC-0001 (Security State Substrate) |
| Author           | -                                                    |
| Created          | 2024-12-27                                           |

---

## Motivation

RFC-0000 Tracehound **decision-free security buffer** tanımlar. External detector threat signal gönderir, Tracehound quarantine eder.

**Ancak kritik bir gap var:**

```
External Detector → Threat Signal → Agent → Quarantine
                                              ↓
                                         Evidence

                                    ❌ Threat metadata?
                                    ❌ Pattern correlation?
                                    ❌ Category statistics?
                                    ❌ Temporal analysis?
                                    ❌ Research data?
```

Quarantine **evidence** (payload) tutuyor, ama **threat hakkında metadata** yok:

- Threat classification eksik
- Category distribution görünmez
- Source correlation yapılamaz
- Temporal pattern invisible
- Research/cure development için veri yok

Bu RFC, **decision-free, observation-only threat metadata substrate** tanımlar.

---

## Goals

| Goal                      | Description                                |
| ------------------------- | ------------------------------------------ |
| **Threat Classification** | Signature, category, severity tracking     |
| **Source Correlation**    | Unique source tracking, co-occurrence      |
| **Temporal Analysis**     | Frequency, burst detection, lifespan       |
| **External Analytics**    | Rich query API for pattern detection       |
| **Research Support**      | Archive for anti-malware, cure development |
| **Observable**            | Read-only snapshots for monitoring         |

---

## Non-Goals

- Threat detection (external concern)
- Decision making (decision-free principle)
- Alert generation (Watcher yapar)
- Policy enforcement
- ML/classification (external analytics)
- Evidence storage (Quarantine yapar)
- Real-time blocking
- Distributed consensus

---

## Architecture

### Component Relationship

```
                    External Detector
                           ↓
                    Threat Signal
                           ↓
        ┌──────────────────┼──────────────────┐
        ↓                  ↓                  ↓
    Muninn       Agent          Quarantine
    (metadata)      (routing)         (evidence)
        ↓
    ┌───┴────┐
    ↓        ↓
  Cold    Archive
  (ops)   (research)
```

**Integration Points:**

```
RFC-0000 Agent → Muninn.record()
RFC-0001 Security State Substrate ← Muninn (separate namespace)
RFC-0002 Argos + Muninn → External Analytics
```

### Layer Model

```
┌─────────────────────────────────────────────────┐
│           Hot Layer (in-memory)                 │
│  - Real-time query (O(1) lookup)               │
│  - Pattern detection                            │
│  - Active correlation                           │
│  - TTL: 1 hour                                  │
│  - Bounded: 10k records                         │
└────────────┬────────────────────────────────────┘
             │ evict/expire
             ↓
┌─────────────────────────────────────────────────┐
│           Cold Layer (NDJSON)                   │
│  - Operational logs                             │
│  - External tool compatible                     │
│  - Append-only, write-only                      │
│  - Format: newline-delimited JSON               │
└────────────┬────────────────────────────────────┘
             │ (optional)
             ↓
┌─────────────────────────────────────────────────┐
│           Archive (compressed binary)           │
│  - Research/cure development                    │
│  - Pattern analysis                             │
│  - ML training data                             │
│  - Compressed + integrity hash                  │
│  - Evidence linking                             │
└─────────────────────────────────────────────────┘
```

---

## Type Definitions

### Muninn Interface

```ts
interface Muninn {
  /** Record threat metadata (sync, non-blocking) */
  record(entry: ThreatEntry): void

  /** Query hot layer (O(1) lookup, O(n) filter) */
  query(filter: ThreatQuery): ReadonlyArray<ThreatRecord>

  /** Aggregate statistics */
  stats(): ThreatStats

  /** Observable snapshot (readonly) */
  snapshot(): MuninnSnapshot

  /** Manual archive trigger */
  archive(signature: string): void

  /** Lifecycle */
  dispose(): void
}
```

### ThreatEntry (Input)

```ts
interface ThreatEntry {
  signature: string // from RFC-0000 Agent
  category: ThreatCategory
  severity: Severity
  source: string
  timestamp: number

  // Optional
  metadata?: Record<string, unknown>
  evidenceHandle?: string // link to Quarantine
}

type ThreatCategory = 'injection' | 'ddos' | 'flood' | 'spam' | 'malware' | 'unknown'

type Severity = 'low' | 'medium' | 'high' | 'critical'
```

### ThreatRecord (Hot Layer)

```ts
interface ThreatRecord {
  // Identity
  signature: string
  category: ThreatCategory
  severity: Severity

  // Temporal
  firstSeen: number
  lastSeen: number
  occurrences: number
  lifespan: number // lastSeen - firstSeen

  // Correlation
  sources: Set<string> // unique sources
  relatedSignatures: Set<string> // co-occurring threats

  // Evidence linking
  evidenceHandles: Set<string> // Quarantine references

  // Metadata
  metadata: Record<string, unknown>

  // Internal (memory management)
  _expiresAt: number
  _weight: number
}
```

### ArchivedThreatRecord

```ts
interface ArchivedThreatRecord {
  // Core data
  signature: string
  category: ThreatCategory
  severity: Severity

  // Temporal
  firstSeen: number
  lastSeen: number
  occurrences: number
  lifespan: number

  // Correlation
  sources: string[] // Set → Array for serialization
  uniqueSources: number

  // Archive metadata
  archivedAt: number
  reason: 'evict' | 'ttl' | 'manual'

  // Evidence linking
  evidenceHandles?: string[]

  // Integrity
  hash: string // SHA-256 of compressed data
}
```

### Configuration

```ts
interface MuninnConfig {
  // HOT LAYER
  hot: {
    maxRecords: number // default: 10_000
    maxSources: number // default: 1_000
    ttl: number // default: 3600_000 (1 hour)
    evictionPolicy: 'low-severity-first' | 'lru'
  }

  // COLD LAYER (optional)
  cold?: {
    enabled: boolean
    path: string // e.g., '/var/log/tracehound/ledger.ndjson'
    format: 'ndjson'

    // Write strategy
    syncStrategy: 'async'
    batchSize: number // default: 100
    batchInterval: number // default: 5000ms

    // Rotation
    rotation?: {
      strategy: 'size' | 'time'
      maxSize?: number // bytes
      interval?: number // ms
      keepFiles?: number
    }
  }

  // ARCHIVE LAYER (optional)
  archive?: {
    enabled: boolean
    path: string // e.g., '/var/lib/tracehound/archive'

    // Compression
    codec: 'gzip' | 'brotli' // default: 'gzip'
    compressionLevel: number // default: 6

    // Integrity
    integrity: 'hash' | 'signature' // default: 'hash'

    // Trigger
    onEvict: boolean // archive when evicted
    onTTL: boolean // archive when expired

    // Retention
    maxArchiveSize?: number
    rotation?: ArchiveRotationConfig
  }

  // Audit
  auditLog: (entry: AuditEntry) => void
}
```

### Query API

```ts
interface ThreatQuery {
  signature?: string
  category?: ThreatCategory
  severity?: Severity
  source?: string

  timeRange?: {
    start: number
    end: number
  }

  minOccurrences?: number

  limit?: number
  offset?: number
}

interface ThreatStats {
  total: number
  byCategory: Record<ThreatCategory, number>
  bySeverity: Record<Severity, number>
  uniqueSources: number

  topSources: Array<{ source: string; count: number }>
  topSignatures: Array<{ signature: string; count: number }>

  recentBurst: boolean // spike detection
  avgFrequency: number // threats per minute

  hot: {
    records: number
    bytes: number
    evictions: number
    expired: number
  }
}
```

---

## Behavior

### Record Flow

```ts
// Agent integration
const result = agent.intercept(scent)

if (result.status === 'quarantined') {
  // Parallel recording (non-blocking)
  Muninn.record({
    signature: result.handle.signature,
    category: scent.threat.category,
    severity: scent.threat.severity,
    source: scent.source,
    timestamp: scent.timestamp,
    evidenceHandle: result.handle.id,
  })
}
```

### Hot Layer Operations

**Write (O(1)):**

```ts
record(entry: ThreatEntry): void {
  const existing = this.records.get(entry.signature)

  if (existing) {
    // Update existing
    existing.lastSeen = entry.timestamp
    existing.occurrences++
    existing.sources.add(entry.source)
    existing._expiresAt = Date.now() + this.config.hot.ttl

    if (entry.evidenceHandle) {
      existing.evidenceHandles.add(entry.evidenceHandle)
    }
  } else {
    // New record
    const record: ThreatRecord = {
      signature: entry.signature,
      category: entry.category,
      severity: entry.severity,
      firstSeen: entry.timestamp,
      lastSeen: entry.timestamp,
      occurrences: 1,
      lifespan: 0,
      sources: new Set([entry.source]),
      relatedSignatures: new Set(),
      evidenceHandles: entry.evidenceHandle
        ? new Set([entry.evidenceHandle])
        : new Set(),
      metadata: entry.metadata || {},
      _expiresAt: Date.now() + this.config.hot.ttl,
      _weight: this._calculateWeight(entry),
    }

    this.records.set(entry.signature, record)
    this._updateIndexes(record)

    // Check capacity
    if (this.records.size > this.config.hot.maxRecords) {
      this._evict()
    }
  }

  // Async cold write (fire-and-forget)
  if (this.config.cold?.enabled) {
    this.coldLayer.append(entry)
  }
}
```

**Read (O(1) get, O(n) filter):**

```ts
query(filter: ThreatQuery): ReadonlyArray<ThreatRecord> {
  let results: ThreatRecord[] = []

  // Fast path: single signature lookup
  if (filter.signature) {
    const record = this.get(filter.signature)
    return record ? [record] : []
  }

  // Use indexes for filtering
  if (filter.category) {
    const sigs = this.byCategory.get(filter.category) || new Set()
    results = Array.from(sigs).map(sig => this.records.get(sig)!)
  } else {
    results = Array.from(this.records.values())
  }

  // Apply filters
  if (filter.severity) {
    results = results.filter(r => r.severity === filter.severity)
  }

  if (filter.source) {
    results = results.filter(r => r.sources.has(filter.source))
  }

  if (filter.timeRange) {
    results = results.filter(r =>
      r.lastSeen >= filter.timeRange.start &&
      r.lastSeen <= filter.timeRange.end
    )
  }

  if (filter.minOccurrences) {
    results = results.filter(r => r.occurrences >= filter.minOccurrences)
  }

  // Pagination
  if (filter.offset) results = results.slice(filter.offset)
  if (filter.limit) results = results.slice(0, filter.limit)

  return results
}
```

### TTL Enforcement

**Lazy check on access:**

```ts
get(signature: string): ThreatRecord | undefined {
  const record = this.records.get(signature)

  if (record && record._expiresAt < Date.now()) {
    this._expire(signature)
    return undefined
  }

  return record
}
```

**Periodic sweep (via Scheduler):**

```ts
// Integration with RFC-0000 Scheduler
scheduler.schedule(
  'threat-ledger-sweep',
  async () => {
    const now = Date.now()
    const expired: string[] = []

    for (const [sig, record] of this.records) {
      if (record._expiresAt < now) {
        expired.push(sig)
      }
    }

    for (const sig of expired) {
      const record = this.records.get(sig)!

      // Archive before removal
      if (this.config.archive?.enabled && this.config.archive.onTTL) {
        this._archive(record, 'ttl')
      }

      this._removeRecord(sig)
    }

    this.auditLog({
      type: 'threat_ledger.sweep',
      expired: expired.length,
      timestamp: now,
    })
  },
  {
    intervalMs: 60_000, // 1 minute
    jitterMs: 10_000,
  }
)
```

### Eviction Policy

```ts
private _evict(): void {
  const policy = this.config.hot.evictionPolicy
  const evictCount = Math.floor(this.config.hot.maxRecords * 0.1) // 10%

  let candidates: ThreatRecord[]

  if (policy === 'low-severity-first') {
    // Priority-based eviction
    candidates = Array.from(this.records.values())
      .sort((a, b) => {
        // 1. Severity (low first)
        const severityOrder = { low: 1, medium: 2, high: 3, critical: 4 }
        if (a.severity !== b.severity) {
          return severityOrder[a.severity] - severityOrder[b.severity]
        }
        // 2. Occurrence (low first)
        if (a.occurrences !== b.occurrences) {
          return a.occurrences - b.occurrences
        }
        // 3. Age (old first)
        return a.firstSeen - b.firstSeen
      })
      .slice(0, evictCount)
  } else {
    // LRU
    candidates = Array.from(this.records.values())
      .sort((a, b) => a.lastSeen - b.lastSeen)
      .slice(0, evictCount)
  }

  for (const record of candidates) {
    // Archive before removal
    if (this.config.archive?.enabled && this.config.archive.onEvict) {
      this._archive(record, 'evict')
    }

    this._removeRecord(record.signature)
  }

  this.auditLog({
    type: 'threat_ledger.eviction',
    count: candidates.length,
    policy,
    timestamp: Date.now(),
  })
}
```

### Cold Layer (NDJSON)

**Write (async batch):**

```ts
class ColdLayer {
  private writeQueue: ThreatEntry[] = []
  private flushTimer: NodeJS.Timeout | null = null

  append(entry: ThreatEntry): void {
    this.writeQueue.push(entry)

    if (this.writeQueue.length >= this.config.batchSize) {
      this._flush()
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this._flush(), this.config.batchInterval)
    }
  }

  private async _flush(): Promise<void> {
    if (this.writeQueue.length === 0) return

    const batch = this.writeQueue.splice(0)
    clearTimeout(this.flushTimer!)
    this.flushTimer = null

    try {
      const lines = batch.map((entry) => JSON.stringify(entry)).join('\n') + '\n'

      await fs.promises.appendFile(this.config.path, lines)
    } catch (err) {
      // Fire-and-forget: log but don't block
      this.auditLog({
        type: 'threat_ledger.cold_write_failed',
        error: err.message,
        entriesLost: batch.length,
        timestamp: Date.now(),
      })
    }
  }
}
```

**Format:**

```
{"signature":"injection:abc123","category":"injection","severity":"high","source":"1.2.3.4","timestamp":1703001234567}
{"signature":"ddos:def456","category":"ddos","severity":"critical","source":"5.6.7.8","timestamp":1703001234890}
```

**Read (external tools):**

```bash
# Category distribution
cat threat-ledger.ndjson | jq '.category' | sort | uniq -c

# Pattern analysis
cat threat-ledger.ndjson | jq -s 'group_by(.signature) | map({sig: .[0].signature, count: length})'

# Source analysis
cat threat-ledger.ndjson | jq '.source' | sort | uniq -c | sort -rn | head -10
```

### Archive Layer (Compressed Binary)

**Archive on evict/expire:**

```ts
private async _archive(
  record: ThreatRecord,
  reason: 'evict' | 'ttl' | 'manual'
): Promise<void> {
  try {
    // 1. Prepare archive record
    const archived: ArchivedThreatRecord = {
      signature: record.signature,
      category: record.category,
      severity: record.severity,
      firstSeen: record.firstSeen,
      lastSeen: record.lastSeen,
      occurrences: record.occurrences,
      lifespan: record.lastSeen - record.firstSeen,
      sources: Array.from(record.sources),
      uniqueSources: record.sources.size,
      evidenceHandles: record.evidenceHandles.size > 0
        ? Array.from(record.evidenceHandles)
        : undefined,
      archivedAt: Date.now(),
      reason,
      hash: '', // will be calculated
    }

    // 2. Serialize + compress
    const json = JSON.stringify(archived)
    const compressed = await this._compress(Buffer.from(json))

    // 3. Calculate integrity hash
    archived.hash = this._hash(compressed)

    // 4. Create binary entry
    const entry: ArchiveEntry = {
      version: 1,
      record: archived,
      compressed,
      integrity: archived.hash,
    }

    // 5. Write (fire-and-forget, async)
    setImmediate(() => this.archiveWriter.write(entry))

  } catch (err) {
    // Non-critical: log but don't block
    this.auditLog({
      type: 'threat_ledger.archive_failed',
      signature: record.signature,
      error: err.message,
      timestamp: Date.now(),
    })
  }
}
```

**Binary format (length-prefixed):**

```
[4 bytes length BE][1 byte version][32 bytes hash][N bytes compressed]
[4 bytes length BE][1 byte version][32 bytes hash][N bytes compressed]
...
```

**Archive reader (external tool):**

```ts
class ThreatArchiveReader {
  async *readArchive(path: string): AsyncGenerator<ArchivedThreatRecord> {
    const stream = fs.createReadStream(path)
    let buffer = Buffer.alloc(0)

    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk])

      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0)
        if (buffer.length < 4 + length) break

        const entry = this._decodeEntry(buffer.subarray(4, 4 + length))

        if (this._verifyIntegrity(entry)) {
          yield entry.record
        }

        buffer = buffer.subarray(4 + length)
      }
    }
  }

  // Pattern analysis for research
  async analyzePatterns(archivePath: string): Promise<ThreatPatterns> {
    const records: ArchivedThreatRecord[] = []

    for await (const record of this.readArchive(archivePath)) {
      records.push(record)
    }

    return {
      topCategories: this._clusterByCategory(records),
      sourcePatterns: this._analyzeSourceBehavior(records),
      temporalPatterns: this._detectBursts(records),
      correlations: this._findCorrelations(records),
    }
  }
}
```

---

## Integration Examples

### Watcher Integration (RFC-0001)

```ts
// Watcher observes Muninn stats
watcher.on('snapshot', () => {
  const stats = Muninn.stats()

  if (stats.recentBurst) {
    watcher.alert({
      severity: 'high',
      type: 'threat_burst_detected',
      category: stats.topCategories[0],
      count: stats.total,
    })
  }

  if (stats.bySeverity.critical > 10) {
    watcher.alert({
      severity: 'critical',
      type: 'high_severity_cluster',
      count: stats.bySeverity.critical,
    })
  }
})
```

### Argos Integration (RFC-0002)

```ts
// Correlate behavioral signals with threat patterns
class ThreatCorrelationAnalyzer {
  analyze(argoSignals: BehavioralSignal[], ledgerStats: ThreatStats): Correlation {
    // Example: Event loop starvation + DDoS pattern
    const ddosCount = ledgerStats.byCategory.ddos
    const eventLoopStall = argoSignals.find(
      (s) => s.axis === 'eventloop' && s.kind === 'starvation'
    )

    if (ddosCount > 50 && eventLoopStall) {
      return {
        confidence: 0.9,
        type: 'ddos_confirmed',
        recommendation: 'escalate',
      }
    }

    return { confidence: 0.0, type: 'none' }
  }
}
```

### External Analytics

```ts
// ML model training
class ThreatMLTrainer {
  async train() {
    const archiveReader = new ThreatArchiveReader()
    const trainingData: TrainingRecord[] = []

    for await (const record of archiveReader.readArchive('/var/lib/tracehound/archive')) {
      trainingData.push({
        features: this._extractFeatures(record),
        label: record.category,
        severity: record.severity,
      })
    }

    const model = this._trainModel(trainingData)
    return model
  }
}

// Pattern extraction for cure development
class CureDeveloper {
  async extractPatterns(category: ThreatCategory): Promise<CurePattern[]> {
    const ledger = createMuninn(config)
    const records = ledger.query({
      category,
      minOccurrences: 10,
    })

    const patterns = this._clusterSimilarThreats(records)
    return patterns.map((p) => this._generateCureSignature(p))
  }
}
```

---

## Memory Budget

| Component                 | Size        | Notes                |
| ------------------------- | ----------- | -------------------- |
| ThreatRecord              | ~200 bytes  | struct + indexes     |
| Hot layer (10k)           | ~2 MB       | records + indexes    |
| Cold write queue (100)    | ~20 KB      | batch buffer         |
| Archive write buffer (50) | ~100 KB     | binary buffer        |
| **Total In-Memory**       | **~2.5 MB** | bounded, predictable |

Archive disk usage separate concern (configurable limits + rotation).

---

## Performance Characteristics

| Operation | Hot Layer            | Cold Layer | Archive    |
| --------- | -------------------- | ---------- | ---------- |
| Write     | O(1)                 | O(1) queue | O(1) queue |
| Read      | O(1) get, O(n) query | N/A        | External   |
| Eviction  | O(n log n)           | N/A        | N/A        |
| TTL sweep | O(n)                 | N/A        | N/A        |

---

## Implementation Notes

### Indexes

```ts
class HotLayer {
  private records = new Map<string, ThreatRecord>()

  // Indexes for fast filtering
  private byCategory = new Map<ThreatCategory, Set<string>>()
  private bySeverity = new Map<Severity, Set<string>>()
  private bySource = new Map<string, Set<string>>()

  // Time-series index for burst detection
  private timeline = new Map<number, Set<string>>() // bucket → signatures
}
```

### Weight Calculation

```ts
private _calculateWeight(entry: ThreatEntry): number {
  const severityWeight = {
    low: 1,
    medium: 2,
    high: 4,
    critical: 8,
  }

  return severityWeight[entry.severity]
}
```

### Burst Detection

```ts
stats(): ThreatStats {
  const now = Date.now()
  const windowMs = 60_000 // 1 minute

  // Count threats in last minute
  const recentCount = Array.from(this.records.values())
    .filter(r => r.lastSeen >= now - windowMs)
    .length

  // Baseline: average over last hour
  const hourCount = this.records.size
  const avgPerMinute = hourCount / 60

  // Burst = 3x baseline
  const recentBurst = recentCount > avgPerMinute * 3

  return {
    // ...
    recentBurst,
    avgFrequency: avgPerMinute,
  }
}
```

---

## Security Considerations

| Aspect           | Guarantee                               |
| ---------------- | --------------------------------------- |
| Decision-making  | NONE - Muninn is observation-only |
| Authorization    | Query API is read-only                  |
| Evidence access  | NO - evidence in Quarantine, not Ledger |
| Payload exposure | NO - only metadata, no payload          |
| Integrity        | Archive uses SHA-256 hash               |
| Tampering        | Archive is append-only, verifiable      |

**Trust model:**

- Muninn metadata is **non-authoritative**
- External analytics MUST verify before decision
- Archive integrity hash prevents silent corruption
- No security decisions based solely on Ledger

---

## Security Checklist

| Threat             | Mitigation                        | Status |
| ------------------ | --------------------------------- | ------ |
| Memory exhaustion  | Bounded hot layer + eviction      | ✅     |
| Disk exhaustion    | Optional rotation + size limits   | ✅     |
| Metadata tampering | Archive integrity hash            | ✅     |
| Query DoS          | Read-only, no blocking operations | ✅     |
| Evidence leakage   | No payload in Ledger              | ✅     |
| Cold write failure | Fire-and-forget, non-critical     | ✅     |
| Archive corruption | Checksum verification on read     | ✅     |

---

## Configuration Example

```ts
const ledgerConfig: MuninnConfig = {
  hot: {
    maxRecords: 10_000,
    maxSources: 1_000,
    ttl: 3600_000, // 1 hour
    evictionPolicy: 'low-severity-first',
  },

  cold: {
    enabled: true,
    path: '/var/log/tracehound/ledger.ndjson',
    format: 'ndjson',
    syncStrategy: 'async',
    batchSize: 100,
    batchInterval: 5000,
    rotation: {
      strategy: 'time',
      interval: 86400_000, // daily
      keepFiles: 7,
    },
  },

  archive: {
    enabled: true,
    path: '/var/lib/tracehound/archive',
    codec: 'gzip',
    compressionLevel: 6,
    integrity: 'hash',
    onEvict: true,
    onTTL: true,
    rotation: {
      strategy: 'time',
      interval: 86400_000 * 7, // weekly
      keepFiles: 12, // ~3 months
    },
  },

  auditLog: (entry) => securityLogger.log(entry),
}

const Muninn = createMuninn(ledgerConfig)
```

---

## Open Questions

1. **Archive format extensibility:** Future support for Parquet/Avro?
2. **Distributed coordination:** Multi-instance ledger aggregation strategy?
3. **ML integration:** Standardized feature extraction API?
4. **Compression trade-off:** gzip vs brotli for research data?

---

## Roadmap Positioning

| Phase       | Component           | Dependencies            |
| ----------- | ------------------- | ----------------------- |
| **Phase 1** | Hot Layer           | RFC-0000                |
| **Phase 2** | Cold Layer (NDJSON) | Phase 1                 |
| **Phase 3** | Archive Layer       | Phase 1, RFC-0000 codec |
| **Phase 4** | Query optimization  | Phase 1                 |
| **Phase 5** | External tools      | Phase 2, Phase 3        |

**Minimal viable:** Phase 1 + Phase 2 (Hot + Cold)
**Research support:** Phase 3 required (Archive)
**Advanced analytics:** Phase 4 + Phase 5
