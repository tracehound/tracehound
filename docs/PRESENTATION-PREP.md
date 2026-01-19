# Tracehound — White-Hat Presentation Prep

## Quick Links (Show These)

| Resource | URL                   |
| -------- | --------------------- |
| Website  | tracehound.co         |
| Pricing  | tracehound.co/pricing |
| Docs     | tracehound/docs/      |

---

## Elevator Pitch

> "WAF yakaladığını biz quarantine + evidence ediyoruz."

**Tracehound = Security Buffer**

- WAF'ın yakaladığı threat'leri izole eder
- Tamper-proof forensic log tutar
- Replay attack kanıtı sağlar

---

## Core Value Props (White-Hat Angle)

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

## Pricing Model (Capacity-Gating)

| Tier       | Price    | Security | Capacity         |
| ---------- | -------- | -------- | ---------------- |
| Starter    | $9/mo    | Full ✓   | 1 process, 64MB  |
| Pro        | $99/mo   | Full ✓   | 8 process, 512MB |
| Enterprise | $499+/mo | Full ✓   | Unlimited + SLA  |

> **Key Point:** Güvenlik özellikleri tüm tier'larda aynı. Fark sadece kapasite.

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
   - Pricing page — tier comparison
   - Checkout flow

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
   - LICENSE-ENFORCEMENT-SPEC.md

---

## Q&A Prep (Olası Sorular)

| Soru                   | Cevap                                              |
| ---------------------- | -------------------------------------------------- |
| "WAF'tan farkı ne?"    | WAF detect eder, biz quarantine + evidence         |
| "Neden decision-free?" | Policy = external. Biz buffer'ız                   |
| "Crack riski?"         | Ed25519 signing + machine fingerprint + heartbeat  |
| "Free tier neden yok?" | Security product = sürekli çalışmalı. Free = sorun |
| "Multi-instance?"      | Local state. Global = Enterprise (Redis)           |
