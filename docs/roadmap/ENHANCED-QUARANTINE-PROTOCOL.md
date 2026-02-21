# Enchanced App-Level Quarantine Protokol

## Sprints

### Faz 0 — Security Protocol Baseline & Threat Contract (Sprint 1)

Bu fazın amacı: “ne garanti ediyoruz / neyi özellikle garanti etmiyoruz”u kodlanabilir hale getirmek.

**Kritik noktalar**

- Teknik iddia ile pazarlama iddiası birebir eşleşmeli.
- “Sandbox yoksa yok” netliği korunmalı (overclaim yapılmamalı).

---

### Faz 1 — One-Way Membrane API Refactor (Sprint 2)

Amaç: runtime API’de evidence bytes erişimini kırmak ve metadata-only sözleşmesine geçmek.

**Unit test kapsamı**

- `InterceptResult` artık handle içermiyor.
- Quarantine inspect/list sadece metadata dönüyor.
- Legacy kullanım compile-time/runtime failure veriyor (beklenen).

**E2E test kapsamı**

- Express/Fastify adaptörlerinde quarantine response bozulmadan çalışıyor.
- API kullanıcıları signature/severity bilgisini alabiliyor, payload alamıyor.

**Simulation testleri**

- “Malicious plugin tries to pull bytes from runtime” senaryosu.
- “High-throughput quarantined events + client metadata fetch” senaryosu.

**QA review**

- Backward compatibility matrix.
- Error message netliği.
- Client SDK migration path.

**Security review**

- Data exfil path diff analizi.
- Public export surface audit.

**OWASP/CWE**

- ASVS V8 (data protection), V10 (malicious input), V14 (config).
- CWE-200/201 (information exposure), CWE-915 (improperly controlled modification).

---

### Faz 2 — Sealed Execution Domain & Capability Segmentation (Sprint 3)

Amaç: runtime ve forensic erişim yetkilerini ayrıştırmak; deterministic parser/serializer dışında veri erişimini kapatmak.

**Unit test kapsamı**

- Runtime capability ile raw bytes erişimi engelli.
- Forensic capability olmadan decode/export başarısız.
- Aynı payload + sürüm = aynı canonical hash.

**E2E test kapsamı**

- Forensic export endpoint/workflow doğru yetkiyle çalışıyor.
- Runtime pipeline performansı capability ayrımından etkilenmiyor.

**Simulation testleri**

- Confused-deputy attack simülasyonu (runtime token ile forensic export denemesi).
- Parser edge-case corpus (deep nesting, key flood, malformed UTF-8).

**QA review**

- Permission boundary dokümantasyonu.
- Hata kodları (403/unauthorized vs validation fail).

**Security review**

- Capability escalation incelemesi.
- Determinism regression analizi.

**OWASP/CWE**

- ASVS V4 (access control), V5 (validation), V8.
- CWE-284 (improper access control), CWE-20, CWE-345.

---

### Faz 3 — Time-Bounded Decay & Passive Archive Pipeline (Sprint 4)

Amaç: active surface’i TTL ile sabit tutmak, DoS baskısını azaltmak, arşivlemeyi kontrollü yapmak.

**Unit test kapsamı**

- TTL expiry hesaplaması.
- Batch decay order determinism.
- Archive policy fallback davranışları.

**E2E test kapsamı**

- End-to-end: quarantine -> TTL expiry -> archive -> active state drop.
- Cold storage unavailable iken policy davranışı.

**Simulation testleri (gerçek dünya)**

- Burst traffic + short TTL + slow object store.
- DoS pressure: maxCount/maxBytes + TTL cleanup yarış durumları.
- Clock skew/jitter senaryoları (monotonic vs wall clock).

**QA review**

- Operasyonel observability: decay lag, archive fail rate, dropped due to policy.
- SLO/SLA etkisi (latency, memory ceiling).

**Security review**

- Data retention / minimization uyumu.
- TTL bypass veya indefinite retention riskleri.

**OWASP/CWE**

- ASVS V8/V14.
- CWE-400 (resource exhaustion), CWE-770 (allocation without limits), CWE-664 (improper lifecycle).

---

### Faz 4 — Full Chain-of-Custody (Purge dahil) (Sprint 5)

Amaç: tüm lifecycle event’leri audit zincirine bağlamak ve adli bütünlüğü tamamlamak.

**Unit test kapsamı**

- Audit chain continuity (tamper detection).
- Mixed event types hash doğrulaması.
- Idempotent append davranışı.

**E2E test kapsamı**

- Tam lifecycle: insert -> purge/evict/decay -> chain verify.
- Recovery sonrası chain verify pass.

**Simulation testleri**

- Partial failure injection (storage timeout, append failure, process crash).
- Replay/reorder event attack simulation.

**QA review**

- Audit export readability + forensic tooling uyumu.
- Chain verification latency.

**Security review**

- Chain tampering threat modeling.
- Non-repudiation/forensic admissibility notları.

**OWASP/CWE**

- ASVS V10 (integrity), V8.
- CWE-345 (insufficient verification of data authenticity), CWE-353 (missing support for integrity check).

---

### Faz 5 — Verification, Compliance, Release Readiness (Sprint 6)

Amaç: ürünü release etmeye hazır hale getirecek kalite ve güvenlik kapılarını tamamlamak.

**QA review (son kapı)**

- Test evidence traceability (invariant -> test -> artifact).
- Ürün dokümantasyonu / API migration bütünlüğü.
- Operasyonel runbook (incident, rollback, forensic export).

**Security review (son kapı)**

- Architecture review board sign-off.
- OWASP ASVS kontrol listesi ve gap gerekçeleri.
- CWE risk acceptance kayıtları.

---

### Sprint Bazlı Entegrasyon Takvimi (özet)

- Sprint 1: Faz 0 (kontrat + invariant + compliance mapping başlangıcı)
- Sprint 2: Faz 1 (membrane API kırılımı + adapter migration)
- Sprint 3: Faz 2 (sealed capability + deterministic export enforcement)
- Sprint 4: Faz 3 (TTL decay + passive archive + pressure simulations)
- Sprint 5: Faz 4 (full chain-of-custody + failure injection)
- Sprint 6: Faz 5 (compliance pack + rollout gates + canary)

---

### Kritik “kaçırılmaması gereken” noktalar

- Overclaim yapma: app-layer quarantine ≠ OS sandbox.
- Hot-path’e yük bindirme: decay/archive kesinlikle background.
- Capability drift engeli: runtime API’ye bytes erişimi geri sızmamalı.
- Audit atomikliği: lifecycle event değiştiyse chain event de değişmeli.
- Config safety: insecure kombinasyonlar validate aşamasında reddedilmeli.
- Simulation gerçekçiliği: sadece happy path değil, storage/network/process failure mutlaka kapsanmalı.

---

## Addendum

### Addendum - Deployment & Observability

Sprint 1:

- Gözlemlenebilirlik sözlüğü oluştur: `ingest_rate`, `quarantine_count`, `quarantine_bytes`, `decay_lag_ms`, `archive_fail_rate`, `audit_chain_verify_failures`.
- Dashboard taslağı çıkar (operasyon + güvenlik görünümü ayrı paneller).
- Alert eşikleri tanımla (warning/critical) ve on-call runbook v1 yaz.

Sprint 2:

- Shadow deployment akışını dev/staging’de devreye al.
- Canary metriği ve rollback kriterlerini otomasyona bağla.
- E2E deployment testi ekle: canary başarısızsa otomatik rollback.

Sprint 3:

- Prod rollout kontrol listesi yayınla.
- Post-release 7 günlük telemetry review ritmini başlat.
- False-positive alert tuning ve SLO ihlal raporu standardize et.

---

### Addendum - Documentation & Migration

Sprint 1:

- Breaking değişiklikler için migration guide yaz:
  - eski API -> yeni API eşleme tablosu
  - örnek kodlar (core/express/fastify)
  - deprecation takvimi.

- “Compatibility matrix” yayınla (hangi sürüm neyi destekliyor).

Sprint 2:

- Migration doğrulama checklist’i ekle:
  - unit migration testleri
  - e2e client integration testleri
  - hata mesajlarında yönlendirici migration linkleri.

- Dokümantasyon QA turu: copy/paste örneklerinin çalışırlığı ve tutarlılık kontrolü.

---

### Addendum - Performance & Hardening

Sprint 1:

- Performans baseline çıkar: p50/p95/p99 intercept latency, memory tavanı, queue/backlog sınırları.
- Hardening checklist v1: parser limits, IPC max frame, timeout, capability boundary.

Sprint 2:

- Simulation testleri ekle:
  - burst traffic
  - slow cold storage
  - TTL storm
  - malformed payload corpus.

- Regresyon kapısı koy: baseline üstü bozulma merge blocker olsun.

Sprint 3:

- Capacity planning raporu üret (yük profiline göre güvenli çalışma aralığı).
- DoS dayanım sonuçlarını güvenlik artefaktına bağla.
- Hardening gap’leri için remediation backlog aç.

---

### Addendum - Security Audit & Sign-off

Sprint 1:

- Faz kapıları için güvenlik checklist tanımla.
- Threat model + invariant mapping’i “gate input” haline getir.

Sprint 2:

- Her sprint sonunda zorunlu security review toplantısı işlet:
  - attack surface diff
  - privilege/capability diff
  - logging/redaction kontrolü.

- High/Critical bulgular için kapanış veya formal risk acceptance kuralını uygula.

Sprint 3:

- Final sign-off paketi hazırla:
  - test evidence
  - residual risk register
  - chain integrity raporu
  - compliance mapping.

- Güvenlik onayı olmadan release’e geçişi engelleyen gate koy.

---

### Addendum - Release & Post-Release

Sprint 1:

- Release candidate kriterlerini kesinleştir:
  - kritik testler pass
  - security sign-off tamam
  - migration docs yayınlanmış.

- Canary başarı metriklerini sayısal eşiklerle yaz.

Sprint 2:

- Kademeli rollout uygula: canary -> %25 -> %50 -> %100.
- Her aşamada otomatik sağlık kontrolü + rollback tetikleyicileri çalıştır.

Sprint 3:

- Post-release 7/30 gün izleme programını işlet:
  - günlük güvenlik telemetrisi
  - haftalık incident triage
  - müşteri migration geri bildirimi.

- Bulgu/incident sonrası “lessons learned + backlog update” döngüsünü zorunlulaştır.
