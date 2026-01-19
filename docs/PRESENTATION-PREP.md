# Tracehound — Presentation Prep

> **Updated:** 2026-01-19
> **Model:** Open-Core + Paid Satellites

## Quick Links

| Resource | URL                    |
| -------- | ---------------------- |
| Website  | tracehound.co          |
| Pricing  | tracehound.co/pricing  |
| Packages | tracehound.co/packages |
| Docs     | tracehound.co/docs     |

---

## Elevator Pitch

> "WAF yakaladığını biz quarantine + evidence ediyoruz."

**Tracehound = Security Buffer**

- WAF'ın yakaladığı threat'leri izole eder
- Tamper-proof forensic log tutar
- Replay attack kanıtı sağlar

---

## Core Value Props

### 1. Fail-Open Semantics

- Agent ASLA throw etmez
- Sistem crash = traffic pass-through
- DoS vector yok

### 2. Process Isolation (HoundPool)

- Child process = ayrı crash domain
- SIGKILL ile timeout
- Memory isolation (OS-level)

### 3. Tamper-Evident Audit Chain

- SHA-256 Merkle chain
- Her entry öncekinin hash'ini içerir
- Değişiklik = chain break (detectable)

### 4. Decision-Free Architecture

- Tracehound karar ALMAZ
- Detection = external (WAF, ML, custom)
- Sadece quarantine + evidence

---

## Open-Core Pricing Model

| Layer          | Price              | Distribution |
| -------------- | ------------------ | ------------ |
| **Substrate**  | FREE (OSS)         | Public npm   |
| **Satellites** | $49/mo per package | Private npm  |
| **Advanced**   | $99/mo per package | Private npm  |
| **Watchtower** | Subscription       | SaaS         |

> **Key Points:**
>
> - Core security features are FREE and open source
> - Payment unlocks capability, not safety
> - Perpetual use with 12-month update entitlement
> - No runtime license enforcement

---

## Satellite Packages

| Package | Purpose                         | Status         |
| ------- | ------------------------------- | -------------- |
| Argos   | Runtime behavioral observation  | In Development |
| Talos   | External policy execution       | Q2 2026        |
| Huginn  | Threat intelligence ingestion   | Q2 2026        |
| Muninn  | Historical ledger & aggregation | Q2 2026        |
| Norns   | Readiness synthesis             | Q3 2026        |
| Furies  | Adversarial stress harness      | Q3 2026        |

---

## Technical Highlights

### Hot-Path Latency

- p50: <0.5ms
- p99: <2ms
- p99.9: <5ms

### Eviction Policy

- Priority-based (low → critical)
- Critical ASLA evict edilmez
- Cold storage evacuation

### IPC Protocol

- Binary, length-prefixed
- JSON yok (security)
- 100k req/s tested

---

## Demo Flow (Önerilen)

1. **Website Tour** (2 min)
   - Packages page — all satellites
   - Pricing page — open-core model

2. **Architecture Diagram** (3 min)
   - RFC-0000 flow chart
   - Component interaction

3. **Code Walkthrough** (5 min)
   - `agent.ts` — intercept flow
   - `fail-safe.ts` — panic system
   - `hound-pool.ts` — process isolation

4. **Docs Review** (5 min)
   - FAIL-OPEN-SPEC.md
   - PERFORMANCE-SLA.md
   - OPEN_CORE_STRATEGY.md

---

## Q&A Prep (Olası Sorular)

| Soru                   | Cevap                                                      |
| ---------------------- | ---------------------------------------------------------- |
| "WAF'tan farkı ne?"    | WAF detect eder, biz quarantine + evidence                 |
| "Neden decision-free?" | Policy = external. Biz buffer'ız                           |
| "Neden open-core?"     | Security substrate must be trustworthy. Open = inspectable |
| "Multi-instance?"      | Local state. Global coordination = satellite package       |
| "Perpetual use?"       | Evet, indirilen versiyon sonsuza kadar çalışır             |

---

## Related Documents

- [OPEN_CORE_STRATEGY.md](./OPEN_CORE_STRATEGY.md) — Licensing rationale
- [PRICING.md](./PRICING.md) — Pricing details
- [FAIL-OPEN-SPEC.md](./FAIL-OPEN-SPEC.md) — Failure semantics
