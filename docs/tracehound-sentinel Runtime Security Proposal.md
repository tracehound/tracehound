# Tracehound Runtime Security Platform – Proposal

## tracehound-sentinel

## 1. Amaç ve Motivasyon

Bu doküman, Tracehound projesinin **eksensel genişlemesini** tanımlar.

Mevcut güvenlik ürünlerinin büyük çoğunluğu:

- Network katmanında (WAF, Edge, Firewall)
- Infrastructure katmanında (VM, Container, K8s)
- Veya source-level (SAST, dependency scanning)

konumlanmıştır.

**Node.js runtime içi davranış**, bu ürünlerin tamamında ciddi bir _blind spot_ oluşturmaktadır.

Tracehound’un hedefi:

> Node.js runtime kurulu olan bir ortamda, **JS runtime’ın temas ettiği güvenlik eksenlerini** deterministik ve davranışsal olarak görünür kılmak.

Bu hedef, yalnızca request tracing ile sınırlı değildir.

---

## 2. Temel Yaklaşım: İki Katmanlı Güvenlik Modeli

Tracehound mimarisi iki bilinçli ve ayrık katmandan oluşur:

### 2.1 tracehound (Core)

**Rol:** Node.js inbound security layer

**Özellikler:**

- Request-biased (HTTP, RPC, gateway girişleri)
- Deterministic
- Sync hot-path
- Decision-free
- OS + child processes dependent

**Biyolojik karşılık:** Hücresel bağışıklık

tracehound, gelen istekler üzerinden tehditleri **izole eder**, **buffer’lar** ve **analiz için hazırlar**.

---

### 2.2 tracehound-sentinel

**Rol:** Node-wide runtime observer (humoral layer)

**Özellikler:**

- Request lifecycle dışı
- Node.js runtime geneline yayılan gözlem
- Internal spy / patrol yaklaşımı
- Davranışsal sinyal üretimi
- Karar vermez, block etmez

**Biyolojik karşılık:** Humoral bağışıklık (antikora denk)

tracehound-sentinel, tracehound’un kapsamadığı **runtime davranış eksenlerini** gözlemler.

---

## 3. tracehound-sentinel’in Kapsadığı Eksenler

Sentinel, Node.js runtime’ın **alakadar olduğu** alanları kapsar.

### 3.1 Runtime Integrity

- Node.js version / binary değişimleri
- Frozen intrinsics bütünlüğü
- Critical global object davranışları
- Runtime flag anomalileri

### 3.2 Event Loop & Child Process Davranışı

- Event loop latency drift
- Microtask starvation
- Child process spawn / termination anomalileri
- Thread exhaustion pattern’leri

### 3.3 Internal Communication Patterns

- Internal request / response yoğunluk değişimleri
- Header shape drift (payload değil, yapı)
- Cardinality anomalileri

### 3.4 Container & Orchestration Etkileşimi

Sentinel **container içine girmez**, fakat:

- Container lifecycle
- Image digest değişimleri
- Restart / crash loop paterni
- Resource usage drift

üzerinden davranışsal görünürlük sağlar.

### 3.5 CI / CD ve Pipeline Etkileşimi

Sentinel:

- Source code analiz etmez
- Pipeline script yorumlamaz

Ancak şunları izler:

- Build artifact hash değişimleri
- Release cadence drift
- Unexpected job / pipeline spawn
- Environment mutation sinyalleri

---

## 4. Bilinçli Olarak KAPSAM DIŞI BIRAKILANLAR

Bu netlik ürünün sürdürülebilirliği için kritiktir.

Sentinel:

- Kernel memory görmez
- Syscall tracing yapmaz
- Process içi memory dump almaz
- Native addon içini analiz etmez
- Karar almaz
- Müdahale etmez

Bu alanlar **EDR / OS-level** ürünlerin sorumluluğudur.

---

## 5. tracehound ↔ sentinel İlişkisi

İlişki tek yönlüdür:

```
tracehound-sentinel
   ↓ (signal)
External detector / policy
   ↓ (classified threat)
tracehound core
```

- Sentinel tracehound’u yönetmez
- Tracehound sentinel’e güvenmez
- Aralarındaki bağ gevşektir

Bu izolasyon, determinism ve debug edilebilirliği korur.

---

## 6. Cloud & Enterprise Konumlandırma

Tracehound, cloud vendor’ları ile **rekabet etmez**.

| Platform          | Ne Görür                 |
| ----------------- | ------------------------ |
| Cloudflare        | Edge / network           |
| AWS / GCP / Azure | Infra / managed services |
| Tracehound        | JS runtime davranışı     |

Bu, enterprise için **tamamlayıcı bir güvenlik katmanı**dır.

---

## 7. Ürün Konumlandırması

Tracehound **şunlar değildir**:

- APM
- WAF
- Logging platform
- SAST

Tracehound:

> Node.js runtime için **deterministic + behavioral security visibility** sağlar.

---

## 8. Ticari Perspektif

"Ayda X dolar → sadece request trace" yaklaşımı:

- Commodity
- SMB / indie pazarı
- Düşük savunma hattı

Tracehound’un hedefi:

- Enterprise-grade
- Defense-in-depth
- Runtime blind spot kapatma

Bu, farklı bir fiyatlama ve satış dili gerektirir.

---

## 9. Açık Alanlar (Çalışma Konuları)

Bu proposal, aşağıdaki analizler için zemin oluşturur:

- Rakip analizi (APM, EDR, runtime security)
- Deployment modelleri (bare metal, container, k8s)
- Sentinel sinyal seti minimalizmi
- Enterprise entegrasyon yüzeyleri
- Lisanslama ve tier modeli

---

## 10. Özet

- tracehound ve sentinel ayrımı bilinçlidir
- Ürün ekseni request tracing’in ötesindedir
- Node.js runtime güvenliği odak noktadır
- Cloud vendor’lar tamamlayıcıdır
- Hedef: görünürlük, değil müdahale
