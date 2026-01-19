# RFC-0006: Heimdall — Supply Chain Security Package

> **Status:** Draft
> **Author:** Cluster.127
> **Created:** 2026-01-19
> **Product:** `@tracehound/heimdall`
> **Tier:** Role-Based ($49/mo)

---

## Summary

Heimdall is a supply chain security package that monitors, scans, and reports on package dependencies. Named after the Norse god who guards the Bifröst bridge and watches for invaders.

---

## Motivation

- **%55+ of Node.js security incidents** by 2026 will be supply chain attacks
- Existing tools (npm audit, Snyk) are point-in-time scans
- No integration between dependency scanning and runtime quarantine
- Compliance teams need automated, continuous monitoring

---

## Product Classification

| Aspect           | Value                                  |
| ---------------- | -------------------------------------- |
| **Layer**        | Satellite (Role-Based)                 |
| **Price**        | $49/mo                                 |
| **Relationship** | Symbiotic with Tracehound Core         |
| **Independence** | Can run standalone, enhanced with Core |

---

## Core Components

### 1. Package Scanner

```typescript
import { createScanner } from '@tracehound/heimdall'

const scanner = createScanner({
  packageManager: 'npm', // 'npm' | 'yarn' | 'pnpm'
  lockfileOnly: true, // Only scan lockfile (faster)
  severity: 'moderate', // 'low' | 'moderate' | 'high' | 'critical'
})

const results = await scanner.scan('./package-lock.json')
```

**Output:**

- Vulnerability list with CVE IDs
- Affected package paths (transitive deps)
- Severity scoring (CVSS)
- Remediation suggestions

### 2. CI/CD Integration

```yaml
# .github/workflows/heimdall.yml
name: Heimdall Security Scan
on: [push, pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: tracehound/heimdall-action@v1
        with:
          fail-on: high
          report-format: sarif
```

**Supported Platforms:**

- GitHub Actions
- GitLab CI
- CircleCI
- Jenkins
- Azure DevOps

### 3. Daily Source Monitor

```typescript
const monitor = createMonitor({
  sources: [
    'npm-advisories', // Official npm advisories
    'github-advisories', // GitHub Security Advisories
    'nvd', // NIST NVD
    'custom-feed', // Custom CVE feed URL
  ],
  schedule: '0 6 * * *', // Daily at 6 AM
  notify: {
    webhook: process.env.SLACK_WEBHOOK,
    email: 'security@company.com',
  },
})
```

### 4. Report Generator

```typescript
const report = await scanner.generateReport({
  format: 'pdf', // 'pdf' | 'json' | 'sarif' | 'html'
  includeTransitive: true,
  complianceFramework: 'soc2', // 'soc2' | 'hipaa' | 'pci-dss'
})

await report.save('./security-report.pdf')
```

### 5. Tracehound Integration (Optional)

```typescript
import { createBridge } from '@tracehound/heimdall'

const bridge = createBridge({ agent })

// Flag suspicious dependency activity as threat
bridge.on('critical-vuln', (vuln) => {
  agent.intercept({
    id: generateSecureId(),
    timestamp: Date.now(),
    source: 'heimdall',
    payload: { type: 'supply-chain', vuln },
    threat: {
      category: 'malware',
      severity: 'critical',
      metadata: { cve: vuln.cve },
    },
  })
})
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         HEIMDALL                             │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Scanner   │  │   Monitor   │  │   Report Generator  │  │
│  │ (lockfile)  │  │ (CVE feeds) │  │   (PDF/SARIF/JSON)  │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                     │             │
│         └────────────────┼─────────────────────┘             │
│                          ▼                                   │
│                   ┌─────────────┐                            │
│                   │    Bridge   │ (Optional)                 │
│                   └──────┬──────┘                            │
│                          │                                   │
└──────────────────────────┼───────────────────────────────────┘
                           ▼
                  ┌─────────────────┐
                  │ TRACEHOUND CORE │
                  │   (Quarantine)  │
                  └─────────────────┘
```

---

## Naming Rationale

| Name         | Reason                                                                  |
| ------------ | ----------------------------------------------------------------------- |
| **Heimdall** | Norse god, guardian of Bifröst (rainbow bridge to Asgard)               |
|              | Sees and hears everything happening in all nine worlds                  |
|              | Guards against giants (invaders) crossing into Asgard                   |
|              | **Perfect metaphor:** Dependencies = bridge, Vulnerabilities = invaders |

### Mythological Package Family

| Package      | Mythology | Role                                    |
| ------------ | --------- | --------------------------------------- |
| Argos        | Greek     | Runtime observer (100 eyes)             |
| Talos        | Greek     | Policy enforcement (bronze guardian)    |
| Huginn       | Norse     | Thought/intelligence gathering          |
| Muninn       | Norse     | Memory/history                          |
| Norns        | Norse     | Fate/readiness (past, present, future)  |
| Furies       | Greek     | Vengeance/stress testing                |
| **Heimdall** | Norse     | Supply chain watcher (Bifröst guardian) |

---

## API Surface

```typescript
// Core exports
export { createScanner } from './scanner'
export { createMonitor } from './monitor'
export { createBridge } from './bridge'
export { generateReport } from './report'

// Types
export type { ScanResult, Vulnerability, MonitorConfig, ReportFormat, ComplianceFramework }
```

---

## Success Criteria

- [ ] Scans complete in <10s for typical project (500 deps)
- [ ] Zero false negatives on known CVEs
- [ ] <1% false positive rate
- [ ] GitHub/GitLab actions available at launch
- [ ] PDF reports pass SOC2 auditor review

---

## Timeline

| Milestone          | Target   |
| ------------------ | -------- |
| RFC Approval       | Week 1   |
| Core Scanner       | Week 2-3 |
| CI/CD Actions      | Week 4   |
| Monitor + Reports  | Week 5-6 |
| Bridge Integration | Week 7   |
| Beta Release       | Week 8   |

---

## Open Questions

1. Should Heimdall support non-Node.js ecosystems (pip, cargo, go mod)?
2. Real-time vs scheduled scanning — both or one first?
3. License scanning (GPL contamination detection) in scope?

---

## References

- [npm audit documentation](https://docs.npmjs.com/cli/v9/commands/npm-audit)
- [NIST NVD](https://nvd.nist.gov/)
- [GitHub Security Advisories](https://github.com/advisories)
- [SARIF format](https://sarifweb.azurewebsites.net/)
