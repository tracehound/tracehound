# RFC-0005: Huginn — External Threat Feed Integration

## Metadata

| Field            | Value                                    |
| ---------------- | ---------------------------------------- |
| Status           | Placeholder (v2.0.0 scope)               |
| Security Impact  | Medium (enrichment capability)           |
| Operational Risk | Low (read-only integration)              |
| Dependencies     | RFC-0000 (Core), RFC-0003 (ThreatLedger) |
| Author           | -                                        |
| Created          | 2024-12-27                               |

---

## Motivation

Security review identified lack of threat intelligence correlation:

> "External threat feeds ile korelasyon yok:
>
> - Known bad IPs (AbuseIPDB, Project Honeypot)
> - CVE databases
> - YARA rules
> - MITRE ATT&CK mapping
>
> Bir IP'den gelen threat 'new' olarak görünür, ama aslında globally known botnet node."

This RFC introduces **optional** threat intelligence enrichment.

---

## Core Principle: Enrichment, Not Detection

**Huginn does NOT detect threats.**

```
ThreatEntry (from quarantine)
        │
        ▼
Huginn (lookup)
        │
        ▼
EnrichedThreat (metadata added)
```

Detection remains external. ThreatIntel only **enriches** existing threat entries.

---

## Proposed Types

```ts
interface ThreatIntelSource {
  /** Lookup source reputation */
  lookup(source: string): Promise<ThreatIntelResult>

  /** Enrich existing threat entry */
  enrich(threat: ThreatEntry): Promise<EnrichedThreat>
}

interface ThreatIntelResult {
  source: string
  reputation: number // 0-100 (0 = known bad, 100 = clean)
  knownAttacker: boolean
  lastSeen?: number
  categories: string[]
}

interface EnrichedThreat extends ThreatEntry {
  intel: {
    reputation: number
    knownAttacker: boolean
    associatedCampaigns: string[]
    cveMappings: string[]
    attackTechniques: string[] // MITRE ATT&CK IDs
  }
}

interface HuginnConfig {
  /** Intel sources to query */
  sources: ThreatIntelSource[]

  /** Cache TTL for lookups (ms) */
  cacheTTL: number

  /** Timeout per source (ms) */
  queryTimeout: number

  /** Fail-open on timeout */
  failOpen: boolean
}
```

---

## Reference Sources (Non-Normative)

| Source           | Type              | API      |
| ---------------- | ----------------- | -------- |
| AbuseIPDB        | IP reputation     | REST     |
| Project Honeypot | IP reputation     | DNS      |
| VirusTotal       | File/URL analysis | REST     |
| AlienVault OTX   | Threat indicators | REST     |
| MITRE ATT&CK     | Technique mapping | Local DB |

---

## Integration Pattern

```ts
const intelAdapter = cueateHUginn({
  sources: [abuseIPDBSource({ apiKey: '...' }), projectHoneypotSource({ accessKey: '...' })],
  cacheTTL: 3600_000, // 1 hour
  queryTimeout: 5000,
  failOpen: true,
})

// Enrich on quarantine
tracehound.on('quarantine', async (threat) => {
  const enriched = await intelAdapter.enrich(threat)

  if (enriched.intel.knownAttacker) {
    // Higher priority response
    policyEngine.escalate(enriched)
  }
})
```

---

## Scope

### In Scope

- IP/source reputation lookup
- Threat entry enrichment
- MITRE ATT&CK mapping
- Campaign association

### Out of Scope

- Threat detection (external)
- Blocking decisions (ResponseEngine)
- Real-time feed streaming
- YARA rule execution

---

## Security Considerations

| Concern          | Mitigation                   |
| ---------------- | ---------------------------- |
| API key exposure | Encrypted config, no logging |
| Rate limiting    | Per-source rate limits       |
| Cache poisoning  | TTL + signature verification |
| Timeout abuse    | Fail-open with logging       |

---

**Status: PLACEHOLDER**

Full specification will be written during Phase 7 planning.
