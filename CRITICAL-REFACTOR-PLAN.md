# CRITICAL-REFACTOR-PLAN

> Status: ACTIVE (Wave 1 implemented, Wave 2 in-progress)
> Priority: P0/P1
> Updated: 2026-03-05

## 1) Critical Findings (Gercek Kod Durumu)

1. `hound-process` analiz yolu stub/no-op idi; artik deterministic analiz (hash/entropy/type/size) mesaji uretiliyor.
2. CLI `status/watch/stats` komutlari fabricated healthy/default-zero gostermemeli; gecerli imzali snapshot yoksa acik hata vermeli (`NO_INSTANCE`, `INTEGRITY_VIOLATION`).
3. `IAgent.getStats` eksikligi bulgusu guncel degildi: method sinifta vardi, parity eksigi interface tarafindaydi.
4. `rateLimiter.tighten` ve `agent.setInlineOnlyMode` varsayimlari kod tabaninda yok; bu plan kapsamindan cikarildi.
5. Snapshot guvenligi: random instance-secret yaklasimi cikarildi; deterministic ortak secret kaynagi zorunlu.
6. Core `src` icinde `throw new Error(...)` kullanimlari standart disiydi; typed `Errors` factory modeline alinmali.
7. Adapter kalite borcu: Fastify default export ve `safeClone(any)` kaliplari TS/adapter standartlariyla uyumsuzdu.

## 2) Wave Modeli

## Wave 1 (Patch / P0): Operational Truth + Minimum Security Fix

### 2.1 RFC

- Yeni RFC: `docs/rfc/0013-OperationalTruthAndHoundAnalysis.md` (Draft)
- Kapsam: operational truth, signed snapshot, deterministic hound analysis, decision-free pressure uyumu.

### 2.2 Proposed Change 0.1: IAgent Interface Parity

- `IAgent` kontratina `getStats(): Readonly<AgentStats>` eklendi.
- Tespit duzeltmesi: issue method eksikligi degil, interface parity eksikligiydi.

### 2.3 Snapshot Security ve Runtime Export

- Yeni modül: `packages/core/src/utils/system-snapshot.ts`
- `ITracehound.snapshot(): SystemSnapshot`
- `TracehoundOptions.snapshot`:
  - `path: string`
  - `secret?: string` (fallback: `TRACEHOUND_SNAPSHOT_SECRET`)
  - `intervalMs?: number` (default `1000`)

Kurallar:

- Snapshot aktifken secret yoksa config hatasi (`CONFIG_SNAPSHOT_SECRET_MISSING`).
- Imza: HMAC-SHA256.
- Verify: constant-time compare.
- Yazma: atomic (`.tmp` + rename).
- POSIX: `0600` best-effort.
- Windows: ACL guarantee edilmez; limitation dokumante edilir, warning verilir.

### 2.4 CLI Truth Wiring

- `status`, `stats`, `watch` komutlari imzali snapshot dosyasindan okur.
- Snapshot yoksa veya verify fail ise fabricated data yerine acik hata verir.
- JSON ciktilarinda `connected: false` ve hata kodu gorunur.

### 2.5 Hound Real Analysis (Deterministic)

`processPayload` artik su metadatalari uretir:

- `hash` (SHA-256)
- `entropy`
- `contentType` (magic-byte + text/json hint)
- `sizeBytes`

IPC/Pool genisletmeleri:

- `HoundMessage` union -> `analysis`
- `HoundResult.analysis?` alaninin parent tarafa tasinmasi

### 2.6 Wave 1 Test Scope

- CLI testleri fixture signed snapshot ile guncellendi.
- Hound process testleri davranis testine cevrildi.
- `tracehound.test.ts` icindeki private bypass (`as any`) azaltildi ve public API assertion'lari eklendi.

## Wave 2 (Minor): Tam Borc Temizligi

### 3.1 Core Error Model Standardizasyonu

- Core runtime path'lerinde `throw new Error(...)` kaldirilir.
- `Errors` factory ve yeni kodlar kullanilir (or. `PROCESS_IPC_DECODE_FAILED`, `CONFIG_SNAPSHOT_SECRET_MISSING`).

### 3.2 Process Isolation Sertlestirme

- Child spawn env mirasini whitelist'e indir.
- `hound-process` env bagimliligini production yolundan cikar.
- Capability/telemetry raporlamasi ile declarative kisitlarin gozlemlenmesi.

### 3.3 Pressure Containment 2.2 (RFC-0011 Uyumlu, Decision-Free)

- Inline fast-check ve karar ureten mantik yok.
- Bounded queue + drop-and-count + overload sinyali.
- `Watcher.setOverloaded()` wiring.
- Severity-aware deterministic shedding.

### 3.4 Adapter Kalite Temizligi

- Fastify default export kaldirilir (named export only).
- `safeClone(any)` -> `unknown`/`JsonSerializable` guvenli modele cevrilir.
- Adapter smoke/fail-open testleri korunur.

### 3.5 Test ve Kapsam Disiplini

- `as any` azaltimi (ozellikle production davranis testlerinde).
- Scenario suite tam kosum (`packages/core/scenarios`).
- Coverage esikleri korunur (90/90/90/85).

## 4) Public API / Interface Degisiklikleri

1. `IAgent.getStats(): Readonly<AgentStats>`
2. `ITracehound.snapshot(): SystemSnapshot`
3. `TracehoundOptions.snapshot` blogu (`path`, `secret`, `intervalMs`)
4. `HoundMessage` union -> `analysis`
5. `HoundResult.analysis?`
6. Core exportlar: snapshot tipleri/util'leri

## 5) Verification Gates

## Pre-change Gate

- Baseline test (etkilenen paketler) yesil.
- RFC-0013 referansi dogrulanir.

## Wave 1 Post-change Gate

- `pnpm --filter @tracehound/core test`
- `pnpm --filter @tracehound/cli test`
- `pnpm lint`
- API/Config dokuman guncellemesi

## Wave 2 Post-change Gate

- `pnpm --filter @tracehound/core test`
- `pnpm exec vitest run scenarios` (`packages/core`)
- Coverage gate (`test:coverage` / paket coverage)
- Lint gate

## Fonksiyonel Acceptance

- `status/watch/stats`: instance yoksa not-connected/hata verir.
- Snapshot integrity bozuldugunda acik uyarı verir.
- Hound metriklerinde `avgProcessingMs > 0` ve analysis metadata gorunur.
- Fabricated healthy/default-zero operational output yoktur.

## 6) Snapshot Security Revizyon Notlari

- Random per-instance default secret ifadesi kaldirildi.
- Deterministic secret source zorunlu: explicit config veya `TRACEHOUND_SNAPSHOT_SECRET`.
- Windows ACL iddiasi "best-effort + documented limitation" olarak guncellendi.

## 7) Unknowns -> Kapatma ve Operasyonel Olcum

1. Rust pivot belirsizligi, RFC-0008 ile hizalandi:
   - JS deterministik analiz bridge katmani; Rust pivot stratejik roadmap maddesi.
2. "Hangi payload tipleri baskin?" belirsizligi:
   - `contentType` dagilimi metrigi toplanacak.
3. "Hound latency etkisi ne?" belirsizligi:
   - p50/p95/p99 `avgProcessingMs` ve timeout oranlari izlenecek.
4. "Snapshot error pattern nedir?" belirsizligi:
   - `NO_INSTANCE` ve `INTEGRITY_VIOLATION` olay sayaci izlenecek.

## 8) Nerede Kaldik (2026-03-05 / Session Update)

### Tamamlandi (bu session)

1. CLI `stats --json` disconnected modeli sertlestirildi:
   - `connected: false` durumunda explicit `error` + `path` donuyor.
   - Fabricated runtime zero threat metrikleri disconnected JSON'dan kaldirildi.
2. Snapshot freshness/integrity korumasi guclendirildi:
   - Future-dated snapshot reject (default skew: 5000ms).
   - `TRACEHOUND_SNAPSHOT_MAX_FUTURE_SKEW_MS` override eklendi.
3. Graceful shutdown operational-truth duzeltmesi:
   - `Tracehound.shutdown()` snapshot dosyasini best-effort temizliyor.
   - Shutdown sonrasi stale healthy gorunum penceresi kapatildi.
4. Core typed error model uyumu:
   - `Agent.intercept()` catch blogunda manuel error objesi kaldirildi.
   - `Errors.interceptFailed(...)` factory zorunlu yolu kullanildi.
5. IPC guvenligi ve lifecycle sertlestirme:
   - Hound `status=complete` mesaji analysis metadata yoksa error'a dusuyor.
   - Planned shutdown sirasinda lifecycle noise/panic emission bastirildi.
   - Re-entrant exit callback durumunda duplicate/yanlis error emission onlendi.
6. Negatif/regression test kapsami genisletildi:
   - future snapshot reject
   - disconnected stats json error payload
   - missing analysis -> IPC error
   - planned shutdown no lifecycle error emission
   - agent typed error regression
   - snapshot cleanup on shutdown

### Kalanlar (Wave 2 backlog)

1. Process capability/telemetry raporlamasi (declarative kisit gozlemi) henuz yok.
2. RFC-0011 pressure containment 2.2'nin tam metrik/watcher wiring audit'i tamamlanmadi.
3. Core genelinde `throw new Error` temizligi runtime path disinda (ornek: codec class hierarchy) ayri review dalinda tamamlanacak.
