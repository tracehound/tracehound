# RFC-0001: Core Security State Substrate (SecurityState)

## Metadata

| Field          | Value                                                |
| -------------- | ---------------------------------------------------- |
| Status         | **Accepted** (Replaces Security State Substrate RFC) |
| Classification | Internal / Critical Infrastructure                   |
| Complexity     | Medium (Application Level)                           |
| Dependencies   | Standard JS Map / Set (No native deps)               |
| Author         | -                                                    |
| Created        | 2024-12-27                                           |

---

## 1. Executive Summary

Tracehound Core bileşenleri (Rate Limiter, Threat Ledger, Deduplication) için gerekli olan kısa ömürlü (ephemeral) state yönetimi; daha önceki "Generic Cache" veya "Off-Heap Substrate" yaklaşımları yerine, **Security-First Application State** modeline geçirilmiştir.

Bu modül (`SecurityState`), standart JavaScript `Map` yapısını sarmalayarak (wrapper), onu **generic bir cache olmaktan çıkarıp**, güvenlik ve uyumluluk (compliance) kurallarını zorlayan, sınırları belirli (bounded) bir state motoruna dönüştürür.

**Temel Felsefe:** "It is NOT a cache; it is a governed state container."

---

## 2. Motivation & Pivot

Önceki `WorkingMemory` tasarımı, genel amaçlı bir cache ile güvenlik state'i arasında kimlik bunalımı yaşamaktaydı. Ayrıca `Substrate` (Off-Heap) önerisi, MVP aşaması için gereksiz mühendislik karmaşıklığı (Over-engineering) yaratmaktaydı.

**Yeni Yaklaşım:**

1. **Pragmatizm:** V8 Heap ve JS Map kullanılarak hızlı implementasyon sağlanacak.
2. **Safety:** Standart Map yerine, `ISecurityState` arayüzü ile erişim kısıtlanacak.
3. **Governance:** PII tespiti, Audit Log ve Threat-Aware Eviction özellikleri "Logic Layer"da çözülecek.

---

## 3. Non-Goals

- Genel amaçlı Key-Value store olmak (Redis alternatifi değildir).
- Developer'ların business logic datalarını saklaması (`user_profile` vb. saklanamaz).
- Distributed state coordination (Single process çalışır).
- Argos sinyallerini saklamak (Argos kendi RingBuffer yapısını kullanacaktır).

---

## 4. Architecture

### 4.1. The Interface (`ISecurityState`)

Sistemin kalbi, implementasyon detayını (Map vs Future Substrate) gizleyen katı arayüzdür. Core bileşenleri ASLA doğrudan `Map` veya `Object` kullanmaz.

```typescript
interface ISecurityState {
  // Type-safe setters with mandatory metadata
  setThreat(signature: string, meta: ThreatMetadata): void
  setRateLimit(source: string, count: number): void

  // Compliance & Lifecycle
  get(key: string): StateEntry | undefined
  erase(key: string, reason: ErasureReason): void // GDPR "Right to Erasure"

  // Observability
  stats(): SecurityStateMetrics
}

type ErasureReason =
  | 'gdpr_request' // User deletion request
  | 'retention_expired' // TTL-based automatic
  | 'eviction_pressure' // Memory pressure
  | 'manual_purge' // Admin action

interface SecurityStateMetrics {
  entries: number
  bytesEstimated: number
  evictions: {
    total: number
    byPressure: number
    byTTL: number
  }
  piiBlocked: number
}
```

### 4.2. Bounded Storage Strategy

Standart `Map` yapısının en büyük riski olan "Unbounded Growth" (Sınırsız Büyüme) şu mekanizmalarla engellenir:

1. **Hard Item Limit:** `maxEntries` (örn: 10,000) aşılamaz.
2. **Rough Size Estimation:** Her yazma işleminde payload boyutu (tahmini) hesaplanır. `maxBytes` (örn: 50MB) aşıldığında eviction tetiklenir.
3. **TTL Enforcement:** Her kaydın bir ömrü vardır, lazy-expiration veya periodic sweep ile temizlenir.

---

## 5. Security Features (The "Secret Sauce")

Bu modülü sıradan bir `lru-cache` kütüphanesinden ayıran özellikler buradadır.

### 5.1. Threat-Aware Eviction

Hafıza dolduğunda rastgele veya sadece zamana göre (LRU) silme yapılmaz.

**Eviction Priority:**

1. **Discard:** Expired entries.
2. **Discard:** Low Severity Threats (Info/Low).
3. **Discard:** Clean Rate Limit Counters (No violation).
4. **Preserve:** High/Critical Threats (Evidence chain bozulmamalı).
5. **Preserve:** Active Blocklist entries.

> **Kural:** Sistem baskı altındayken bile "Evidence" (Delil) en son silinen öğe olmalıdır.

### 5.2. PII Guard (Privacy)

Veri state'e yazılmadan önce hafif siklet bir regex taramasından geçirilir.

> [!NOTE] > `piiDetection` varsayılan **OFF**'tur. Yüksek throughput ortamlarında overhead yaratabilir.
> Compliance gereksinimi olan müşteriler için opsiyonel olarak aktifleştirilir.

```typescript
set(key, value) {
  if (this.config.piiDetection) {
    if (PII_REGEX.test(JSON.stringify(value))) {
      this.auditLog('pii_attempt_blocked', { key });
      // Opsiyonel: Maskele veya reddet
      return;
    }
  }
  this.storage.set(key, value);
}
```

### 5.3. Audit Trail

State üzerindeki kritik okuma/yazma/silme işlemleri, `Watcher` modülüne event olarak fırlatılır.

- `state.access.unauthorized`
- `state.erasure.compliance`
- `state.eviction.pressure`

---

## 6. Integration Points

### Core Integration

Tracehound Core, tüm geçici verilerini bu katman üzerinden yönetir.

```typescript
// Agent Example
const securityState = container.resolve(ISecurityState)

// Agent never touches 'new Map()' directly
securityState.setThreat(signature, {
  severity: 'high',
  timestamp: Date.now(),
  // ...
})
```

### Argos Separation (Decoupling)

**Argos bu modülü KULLANMAZ.**
Argos, yüksek frekanslı sinyal toplama (sampling) yaptığı için, overhead yaratmamak adına kendi basit `RingBuffer` (döngüsel dizi) yapısını kullanacaktır. `SecurityState` sadece Core (Güvenlik Karar ve Delil) mekanizması içindir.

---

## 7. Migration Path to Future Substrate

Bu RFC, gelecekteki "Enterprise Hardening" aşaması için kapıyı açık bırakır.

- **Phase 1 (Bugün):** `Map` tabanlı implementasyon. Hızlı, güvenli, production-ready.
- **Phase 2 (Gelecek):** Eğer GC pause süreleri kritik seviyeye ulaşırsa (`>200ms`), `ISecurityState` arayüzünün arkasındaki `Map` implementasyonu, `SlabAllocator` (Binary Buffer) ile değiştirilebilir.
- **Garanti:** Bu değişim yapıldığında, `Agent` veya `RateLimiter` kodlarında **tek satır bile** değişiklik gerekmeyecektir.

---

## 8. Development Guidelines

1. **Do not leak the Map:** `getUnderlyingMap()` gibi metodlar yasaktır.
2. **Estimate, don't calculate:** Byte size hesaplarken CPU yakan kesin hesaplamalar yerine, hızlı tahminler (estimation) kullanın.
3. **Fail-safe:** State yazma işlemi hata verirse (doluysa), Core process çökmemeli, işlem "Best-effort" olarak pas geçilmeli veya `Watcher`'a alarm düşmelidir.
