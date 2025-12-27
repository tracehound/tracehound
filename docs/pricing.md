Evet, kesinlikle değişmeli.

Eski fiyatlandırman (`$299 - $1499`), "Enterprise Sales" (Satış ekibiyle toplantı, sözleşme, uzun ikna süreçleri) gerektiren bir modeldi. Ancak yeni **"Growing SaaS"** stratejimiz ve **Phase 4 (Production Hardening)** hedefimizle, modelin **"Self-Service / Low-Friction"** (Kredi kartını gir, lisans anahtarını al, npm install yap) modeline dönmesi gerekiyor.

Kimse tek instance çalışan (henüz cluster desteği olmayan) bir Node.js kütüphanesine, denemeden ayda 300 dolar vermez. "Adoption" (benimseme) bariyerini düşürmemiz lazım.

İşte Phase 4 ve Phase 7 gerçeklerine göre revize edilmiş **Monetization Stratejisi**:

---

### 1. Yeni Fiyatlandırma Mimarisi: "Per Service" Model

Node.js dünyasında "Request Count" (İstek sayısı) üzerinden fiyatlandırma yapmak (Datadog gibi) antipatiktir; sürpriz fatura korkusu yaratır. "Per CPU/Node" ise Serverless/K8s dünyasında kafa karıştırır.

En temizi: **Per Logical Service (Uygulama Başına)** sabit ücret.

#### **A. Developer / Community (The Hook)**

- **Fiyat:** **$0 (Free)**
- **Hedef:** Developer, Hobbyist, POC.
- **Özellikler:**
- Tek instance (Local state).
- Temel Korumalar (Rate Limit, Agent).
- _Kısıtlama:_ Cold Storage yok, Notification API yok, Support yok.
- _Lisans:_ Non-commercial veya Revenue < $5k/mo (Honor system).

- **Amaç:** Market penetrasyonu. İnsanların `npm install` yapıp kodlarına alışmasını sağlamak.

#### **B. Pro / Growth (Phase 4 Hedef Kitlesi)**

- **Fiyat:** **$49 - $99 / ay** (Servis başına)
- **Hedef:** Growing SaaS, Bootstrapped Startups.
- **Özellikler:**
- Phase 4 özelliklerinin tamamı (Async Codec, Notification API, Evidence Export).
- Email Support (24h SLA).
- Commercial License.

- **Mantık:** Eski $299 çok yüksekti. $49-$99 bandı, bir mühendisin "Müdüre sormadan şirket kartıyla alabileceği" (No-Approval threshold) sınırdır. Sürümden kazanılır.

#### **C. Enterprise / Cluster (Phase 7 Hedef Kitlesi)**

- **Fiyat:** **$499+ / ay** (veya yıllık $5k+)
- **Hedef:** Scale-up şirketler, Fintech, Yüksek Trafikli E-ticaret.
- **Özellikler:**
- **Phase 7 özellikleri:** Multi-Instance (Redis), SIEM Export, Compliance Raporları.
- SLA Garantisi.
- Öncelikli Support.

- **Mantık:** Redis/Cluster desteği geldiğinde ürün "Mission Critical" olur. O zaman fiyatı 5-10 katına çıkarabilirsin.

---

### 2. Argos'un Konumu: "Upsell" (Ek Satış)

Argos'u **$750** gibi tekil bir fiyattan satmak stratejik hataydı. Argos, Tracehound'u tamamlayan bir "Görüş Yeteneği" (Visibility).

Argos için iki yol var:

1. **Standalone (Bağımsız Ürün):** Eğer biri Tracehound kullanmıyorsa ama Node.js Event Loop'unu izlemek istiyorsa.

- **Fiyat:** **$49 / ay**. (APM tool fiyatlarına yakın olmalı).
- _$750 çılgınlıktı, kimse sadece bir loop watcher için bunu vermez._

2. **Add-on (Tracehound İçinde):** Tracehound Pro alan birine "Runtime Behavior da ister misin?" diye sorulur.

- **Fiyat:** **+$29 / ay** (Bundle indirimi).

**Özetle:** Argos bir "Feature Module" gibi davranmalı. Fiyatı düşük tutulmalı ki, Tracehound alan herkes "Bunu da açayım, ucuzmuş" desin.

---

### 3. ThreatLedger (Gelecek)

ThreatLedger (Post-v2.2) tamamen ayrı bir lig. O bir "Data Product".

- Onu şimdilik fiyatlandırma tablolarına koyma. "Contact Sales" veya "Beta" olarak kalsın.

---

### Karşılaştırmalı Tablo (Özet)

| Özellik      | **Community** | **Pro (Growth)**    | **Enterprise (Scale)** |
| ------------ | ------------- | ------------------- | ---------------------- |
| **Fiyat**    | **Ücretsiz**  | **$79 / ay**        | **$499+ / ay**         |
| **Hedef**    | Dev / Test    | Tekil SaaS          | Cluster / High Scale   |
| **Instance** | Single        | Single              | **Multi (Redis)**      |
| **State**    | In-Memory     | In-Memory           | Distributed            |
| **Evidence** | Local Only    | **Export (S3/API)** | SIEM Integration       |
| **Argos**    | ❌            | **+$29/ay**         | Dahil                  |
| **Support**  | Community     | Email               | Priority / Slack       |

### SecOps / Business Tavsiyesi

1. **Launch İndirimi:** Phase 4 ("Production Hardening") bittiğinde, "Early Adopter" programı yap. "Ömür boyu $49" gibi bir teklif sun. İlk 50 müşteriyi içeri almak, 5000 dolar kazanmaktan daha değerlidir çünkü sana "Battle-tested" rozeti verirler.
2. **Lisans Kilidi:** Phase 4'te `License Manager` (Lisans Kontrolü) yazman şart demiştim. Bunu "Soft Lock" yap. Lisans süresi dolsa bile sistemi kapatma (Fail-Open), sadece `watcher`'a "Lisanssız kullanım" uyarısı bas ve notification API'yi durdur. Güvenlik ürünleri fatura ödenmedi diye müşterinin sitesini patlatmamalıdır.

**Sonuç:** Fiyatları radikal şekilde aşağı çektik ama "Adoption" potansiyelini 100 kat artırdık. $1499'luk 1 müşteri yerine, $79'luk 20 müşteri hem daha sürdürülebilir hem de ürünü daha hızlı olgunlaştırır.
