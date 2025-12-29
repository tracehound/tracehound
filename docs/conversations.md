```
pekala soru şu:
tiered subsciption uyguladık ve buna göre core oss modelinde free oldu.
ancak feature+addons premium modelde.
bunu nasıl yapılandıracağız? yani: ayrı github + ayrı development ve lisans?
```

---

> Bu bir mimari/iş modeli sorusu - kod yazmaktan çok strateji gerektirir. Şunu değerlendirelim:

## Open Core Model Seçenekleri

### Seçenek 1: Monorepo + Feature Flags (En Basit)

```
tracehound/
├── packages/
│   ├── core/         # MIT/Apache - Public GitHub
│   ├── pro/          # Proprietary - Private, npm'de @tracehound/pro
│   └── enterprise/   # Proprietary - Private
```

#### Avantajlar:

- Tek development workflow
- Core değişiklikleri anında pro'ya yansır
- CI/CD basit

#### Dezavantajlar:

- Public repo'da private kod referansları olabilir (dikkatli olmalısın)
- Contributor'lar pro kodunu göremez

### Seçenek 2: Ayrı Repolar (Daha Temiz)

```
github.com/tracehound/core     # MIT - Public
github.com/tracehound/pro      # Private - License key ile
github.com/tracehound/argos    # Private - Ayrı ürün
```

#### Avantajlar:

- Net ayrım, contributor confusion yok
- Her ürünün kendi release cycle'ı

#### Dezavantajlar:

- Core'daki breaking change'ler pro'yu bozabilir
- Sync overhead

### Seçenek 3: Hibrit (Önerim)

```
tracehound/core        # Public, MIT
tracehound/extensions  # Private monorepo
├── pro/
├── argos/
├── enterprise/
└── shared/           # Pro+Enterprise ortak kod
```

### Lisans Enforceement:

```typescript
// core/src/license.ts
export function requireLicense(feature: 'pro' | 'enterprise') {
  const key = process.env.TRACEHOUND_LICENSE
  if (!key || !validateKey(key, feature)) {
    throw new Error(`${feature} license required`)
  }
}
```

### Kritik Sorular

- Community contributor'lar pro feature'lara PR atabilecek mi?

  - Hayır → Ayrı repo
  - Evet (core ekip review ile) → Monorepo + CLA

- Pro feature'lar core'a bağımlı mı yoksa standalone mı çalışabilir?

  - Bağımlı → Extensions pattern
  - Standalone olabilir → Ayrı repo

- Lisans validation nasıl olacak?
  - Build-time (npm install sırasında)
  - Runtime (feature kullanılırken)
  - Her ikisi (öneririm)

> Hangi model senin için daha uygun? Cevabına göre lisans mekanizmasını ve repo yapısını detaylandırabilirim.

---

```
1. Net Hayır. Orjinalde bende free tier dahi yoktu. Bu proposal olarak gelince strateji değiştirdim.
2. Standalone olmalı. Kendi Core versionumuz lts olur ve canary flag koyarız. Public için PR+Review-Based gidilir ve orjinali etkilemez.
3. En strict model ne ise o. Crack ihtimalimiz ve deobfuscation ile karşı karşıya kalma riskimiz çok yüksek. Buna dair bir guardrail olmalı.

Licensing Enforcement için nasıl bir strateji öneriyorsun?
```

---

> Bu ciddi bir mimari karar - doğru yapılmazsa ya çok kırılgan ya da çok gevşek olur. İşte en güçlü enforcement stratejileri:

## License Enforcement Stratejisi

### Katman 1: Cryptographic License Key

```typescript
// License format: base64(JSON) + HMAC signature
interface LicensePayload {
  customerId: string
  tier: 'pro' | 'enterprise'
  features: string[]
  expiresAt: number // Unix timestamp
  maxServices: number // Per-service limiti
  machineFingerprint?: string // Hardware binding (opsiyonel)
}
```

#### Validation:

- Asimetrik kriptografi (RSA/Ed25519): Private key sende, public key kodda
- Müşteri license'ı değiştiremez çünkü imza tutmaz
- Offline validation mümkün

### Katman 2: Runtime Telemetry (Phone Home)

```
Startup → License Check (local) → Heartbeat to license.tracehound.io → OK/REVOKE
```

#### Neden gerekli:

- License iptal edildiğinde (chargeback, refund) anında devre dışı
- Aynı license'ın N farklı makinede kullanımını tespit
- Usage analytics (hangi feature kullanılıyor)

#### Graceful degradation:

- Network yoksa → Local cache 7 gün geçerli
- 7 gün sonra → Sadece community features

### Katman 3: Code Obfuscation + Integrity Checks

Terser/Webpack değil, daha agresif:

- JavaScript Obfuscator Pro veya JScrambler

  - Control flow flattening
  - String encryption
  - Dead code injection
  - Anti-debugging hooks

- Self-integrity check:

```typescript
// Kod kendi hash'ini kontrol eder
const EXPECTED_HASH = '...'
const currentHash = hashFunction(codeModule.toString())
if (currentHash !== EXPECTED_HASH) {
  process.exit(1) // Tampered
}
```

### Katman 4: Feature Gating (Defense in Depth)

```typescript
// pro/src/features/evidence-export.ts
import { requireLicense, requireOnline } from '@tracehound/license'

export function exportEvidence(entries: Entry[]) {
  requireLicense('pro', ['evidence-export']) // Throws if invalid
  requireOnline() // Heartbeat check

  // Actual implementation
}
```

Her premium feature kendi kendini korur - tek bir bypass noktası yok.

### Katman 5: Legal + Technical Hybrid

DMCA / Anti-Circumvention:

- License check'i bypass etmek DMCA ihlali (ABD'de federal suç)
- Terms of Service'te açıkça belirt

Watermarking:

- Her müşteriye özgü build (customer ID embedded)
- Crack paylaşılırsa kimin olduğu belli

### Önerilen Mimari

```
┌─────────────────────────────────────────────────┐
│                  npm install                    │
│                      ↓                          │
│  ┌─────────────────────────────────────────┐    │
│  │  @tracehound/pro (obfuscated, signed)   │    │
│  │  ┌─────────────────────────────────┐    │    │
│  │  │  License Validator              │    │    │
│  │  │  - Signature verification       │    │    │
│  │  │  - Expiry check                 │    │    │
│  │  │  - Feature entitlement          │    │    │
│  │  └─────────────────────────────────┘    │    │
│  │                 ↓                       │    │
│  │  ┌─────────────────────────────────┐    │    │
│  │  │  Heartbeat Service              │    │    │
│  │  │  - Online validation            │    │    │
│  │  │  - Revocation check             │    │    │
│  │  │  - Usage reporting              │    │    │
│  │  └─────────────────────────────────┘    │    │
│  │                 ↓                       │    │
│  │  ┌─────────────────────────────────┐    │    │
│  │  │  Feature Modules (gated)        │    │    │
│  │  │  - Evidence Export              │    │    │
│  │  │  - Notification API             │    │    │
│  │  │  - SIEM Integration             │    │    │
│  │  └─────────────────────────────────┘    │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

### Risk Değerlendirmesi

| Tehdit                | Önlem                                         | Kalan Risk |
| --------------------- | --------------------------------------------- | ---------- |
| License key paylaşımı | Machine fingerprint + concurrent limit        | Düşük      |
| Deobfuscation         | Multiple obfuscation layers + integrity check | Orta       |
| Heartbeat bypass      | Grace period sonrası hard fail                | Düşük      |
| Reverse engineering   | Watermarking + legal action                   | Orta       |
| Network intercept     | TLS pinning + signed responses                | Düşük      |

> Soru: License server'ı self-hosted mı olacak yoksa managed SaaS (Keygen.sh, Cryptlex, LicenseSpring) mı tercih edersin? Managed çözümler daha hızlı, self-hosted daha kontrollü.

---

```
third party alerjim var, bunu şimdiye kadar öğrenmiş olman gerekiyordu. dependency = yük | risk
```

---

> Haklısın, özür. O zaman full in-house:

## Self-Hosted License Enforcement Stack

### 1. License Generation (Admin CLI)

```typescript
// tools/license-gen.ts
import { createSign } from 'crypto'
import { readFileSync } from 'fs'

const privateKey = readFileSync('./keys/license.key') // Ed25519

interface LicensePayload {
  id: string
  customerId: string
  email: string
  tier: 'pro' | 'enterprise'
  features: string[]
  maxServices: number
  issuedAt: number
  expiresAt: number
}

function generateLicense(payload: LicensePayload): string {
  const data = Buffer.from(JSON.stringify(payload))
  const sign = createSign('Ed25519')
  sign.update(data)
  const signature = sign.sign(privateKey)

  return Buffer.concat([data, signature]).toString('base64url')
}
```

### 2. License Validation (Runtime - Embedded Public Key)

```typescript
// @tracehound/pro/src/license/validator.ts
import { createVerify } from 'crypto'

// Public key EMBEDDED in code (obfuscated)
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA...
-----END PUBLIC KEY-----`

export function validateLicense(licenseKey: string): LicensePayload {
  const raw = Buffer.from(licenseKey, 'base64url')
  const payload = raw.slice(0, -64) // Ed25519 sig = 64 bytes
  const signature = raw.slice(-64)

  const verify = createVerify('Ed25519')
  verify.update(payload)

  if (!verify.verify(PUBLIC_KEY, signature)) {
    throw new LicenseError('INVALID_SIGNATURE')
  }

  const data: LicensePayload = JSON.parse(payload.toString())

  if (Date.now() > data.expiresAt) {
    throw new LicenseError('EXPIRED')
  }

  return data
}
```

### 3. Heartbeat Server (Minimal - Self-Hosted)

```
license.tracehound.io (Cloudflare Worker or Hono on Fly.io)
├── POST /validate    → License + fingerprint → OK/REVOKED
├── POST /heartbeat   → Periodic ping, usage stats
└── GET  /revoked     → Revocation list (signed)
```

Database: SQLite (Turso) veya Postgres - minimal.

**Revocation Flow:**

- Müşteri chargeback → Admin panelden revoke
- Revoke list güncellenir (signed JSON)
- Client heartbeat → 403 + reason
- Grace period (24h) sonra hard fail

### 4. Machine Fingerprinting

```typescript
// Unique per-deployment, not easily spoofable
function getMachineFingerprint(): string {
  const data = [
    os.hostname(),
    os.cpus()[0]?.model,
    os.totalmem(),
    process.env.HOSTNAME, // K8s pod name için
    process.env.FLY_MACHINE_ID, // Fly.io için
  ]
    .filter(Boolean)
    .join('|')

  return createHash('sha256').update(data).digest('hex').slice(0, 16)
}
```

**Enforcement:**

- İlk activation → Fingerprint kaydedilir
- Farklı fingerprint → "Already activated on another machine"
- Enterprise: N machine allowance

### 5. Code Protection Pipeline

```
# Build pipeline
1. TypeScript → JavaScript (tsc)
2. Bundle (esbuild/rollup)
3. Obfuscate (javascript-obfuscator - local, no SaaS)
4. Inject integrity hash
5. Sign artifact (detached signature)
6. Publish to private npm
```

**Obfuscation config (aggressive):**

```javascript
{
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  stringArray: true,
  stringArrayEncoding: ['rc4'],
  stringArrayThreshold: 0.75,
  selfDefending: true,
  debugProtection: true,
  disableConsoleOutput: true
}
```

### Mimari Özet

```
┌──────────────┐     ┌───────────────────┐     ┌─────────────────┐
│  Admin CLI   │────▶│  License Server   │◀────│  Pro Runtime    │
│  (generate)  │     │  (validate/revoke)│     │  (validate+gate)│
└──────────────┘     └───────────────────┘     └─────────────────┘
       │                      │                        │
       ▼                      ▼                        ▼
┌──────────────┐     ┌───────────────────┐     ┌─────────────────┐
│  Private Key │     │  SQLite/Postgres  │     │  Public Key     │
│  (offline)   │     │  (minimal state)  │     │  (embedded)     │
└──────────────┘     └───────────────────┘     └─────────────────┘
```

> Bu mimariyi bir RFC olarak dokümante edip roadmap'e eklememi ister misin? Yoksa önce başka bir konuya mı geçelim?

```
Bu kritik bir konu, RFC olarak dokümante edip roadmap'e ekler misin? Daha sonra farklı konulara geçebiliriz.
```
