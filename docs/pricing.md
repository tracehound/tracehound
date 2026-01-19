# Tracehound Pricing Model

> **Philosophy:** One security model. Different capacity.
> All tiers include full isolation — no tier is "less secure."

---

## Core Principle

| Security Invariants (All Tiers) | Capacity Features (Tier-Based) |
| ------------------------------- | ------------------------------ |
| Agent.intercept()               | HoundPool scaling              |
| Quarantine                      | Cold Storage                   |
| AuditChain                      | Notification API               |
| RateLimiter                     | Scheduler                      |
| HoundPool (isolation)           | Retention Policy               |

---

## Tier Structure

| Tier           | Price    | HoundPool          | Capacity    |
| -------------- | -------- | ------------------ | ----------- |
| **Starter**    | $9/mo    | 1 process, 64MB    | Constrained |
| **Pro**        | $99/mo   | 8 processes, 512MB | Scaled      |
| **Enterprise** | $499+/mo | Unlimited          | Full + SLA  |

---

## Starter ($9/mo per service)

**Target:** Solo Developers, Small Projects

**Security (Full):**

- Agent, Quarantine, AuditChain, RateLimiter
- HoundPool isolation (1 process, 64MB, 5s timeout)

**Locked (Capacity Features):**

- Cold Storage, Notifications, Scheduler, Retention Policy

---

## Pro ($99/mo per service)

**Target:** Growing SaaS, Bootstrapped Startups

**Security (Full):**

- All Starter security features
- HoundPool scaling (8 processes, 512MB, 30s timeout)

**Unlocked:**

- Cold Storage (S3/R2/GCS)
- Notification API
- Scheduler (jittered)
- Retention & Eviction Policies
- Email Support (24h SLA)

---

## Enterprise ($499+/mo)

**Target:** Scale-ups, Fintech, High-traffic E-commerce

**Full:**

- All Pro features
- HoundPool unlimited scaling
- Multi-instance (Redis coordination)
- SIEM Export (Splunk, Elastic, Datadog)
- Compliance Reports (SOC2, HIPAA)
- Priority Support (Slack, 4h SLA)
- SLA guarantee

---

## License Key (JWT)

| Claim          | Description                |
| -------------- | -------------------------- |
| `sub`          | Customer ID                |
| `tier`         | starter / pro / enterprise |
| `exp`          | Expiration timestamp       |
| `houndPoolMax` | 1 / 8 / -1 (unlimited)     |
| `features`     | Enabled feature list       |

---

## Enforcement Matrix

| Tier       | HoundPool   | Enforcement          |
| ---------- | ----------- | -------------------- |
| Starter    | 1 process   | Init-time validation |
| Pro        | 8 processes | Config-time check    |
| Enterprise | Unlimited   | Telemetry-tracked    |

---

## Argos Pricing (Add-on)

| Standalone | Bundle (with Pro) |
| ---------- | ----------------- |
| $49/mo     | +$29/mo           |

---

## Self-Hosted vs Cloud

| Feature  | Self-Hosted       | Cloud                |
| -------- | ----------------- | -------------------- |
| Price    | License cost      | License + Cloud tier |
| Instance | Customer-managed  | Tracehound-managed   |
| Data     | Customer premises | Tracehound Cloud     |

Cloud pricing TBD in Phase 5.5.
