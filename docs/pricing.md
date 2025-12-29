# Tracehound Pricing Model

> **Philosophy:** No request counting. No surprise bills. One price per logical service.

---

## Tier Structure

| Tier           | Price    | Instances | Enforcement         |
| -------------- | -------- | --------- | ------------------- |
| **Community**  | Free     | 1         | None (honor system) |
| **Pro**        | $79/mo   | 1         | Trust-based         |
| **Enterprise** | $499+/mo | Unlimited | Telemetry-tracked   |

---

## Community (Free)

**Target:** Developers, Hobbyists, POC
**Features:**

- Agent, Quarantine, Rate Limiter
- Local state only (no Cold Storage)
- Community support

**Restrictions:**

- Non-commercial or Revenue < $5k/mo (Honor system)
- No Notification API, no Export

---

## Pro ($79/mo per service)

**Target:** Growing SaaS, Bootstrapped Startups
**Features:**

- All Community features
- Cold Storage (S3/R2/GCS)
- Notification API
- Email Support (24h SLA)
- Commercial License

**Instance Model:**

- Single production instance
- Unlimited dev/staging instances
- **Trust-based enforcement** (no policing)

---

## Enterprise ($499+/mo)

**Target:** Scale-ups, Fintech, High-traffic E-commerce
**Features:**

- All Pro features
- Multi-instance (Redis coordination)
- SIEM Export (Splunk, Elastic, Datadog)
- Compliance Reports (SOC2, HIPAA, ISO)
- Priority Support (Slack, 4h SLA)

**Instance Model:**

- Unlimited production instances
- **Telemetry-tracked** (heartbeat monitoring)
- SLA guarantee

---

## License Key (JWT)

| Claim          | Description                         |
| -------------- | ----------------------------------- |
| `sub`          | Customer ID                         |
| `tier`         | community / pro / enterprise        |
| `exp`          | Expiration timestamp                |
| `maxInstances` | 1 (Pro) / -1 unlimited (Enterprise) |
| `features`     | Enabled feature list                |

---

## Enforcement Matrix

| Tier       | Instance Limit | Enforcement | Grace Period |
| ---------- | -------------- | ----------- | ------------ |
| Community  | 1              | None        | N/A          |
| Pro        | 1              | Trust-based | 7 days       |
| Enterprise | Unlimited      | Telemetry   | 7 days       |

**Pro (Trust-Based):**

- No active policing
- Violation detected via manual audit
- Friendly reminder email

**Enterprise (Telemetry-Tracked):**

- Anonymous heartbeat on startup
- Instance count visible in Admin Panel
- Over-limit triggers automated email
- Persistent over-limit → License suspension

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
