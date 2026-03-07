# Security Checklist

Tracehound bir *runtime security buffer* olduğu için klasik web-app güvenliğinden farklıdır.
Saldırı yüzeyi esas olarak: "input ingestion → normalization → quarantine → decision handoff" zinciridir.

Bu zincirin her adımı için trust-boundary çizilmiş ve veri sınıflandırması yapılmış olmalı. "Untrusted byte → structured artifact → verified artifact" geçişlerinde hangi invariant’ların korunduğu açık yazılmalı.

Net sonuç: *implicit trust var mı*.

Node.js katmanı için minimum tam kapsam şu alanları içerir:

## 1. Memory & Runtime Safety (Node özgü)

Node memory-safe değildir; native bindings, Buffer ve TypedArray yanlış kullanımı veri sızıntısı doğurur. Şunlar kanıtlanmalı:

* Uninitialized Buffer kullanımı yok (`Buffer.allocUnsafe` yasak / lint enforced).
* Object prototype pollution’a karşı deep merge ve deserialization noktaları korunmuş.
* V8 snapshot, vm, dynamic code execution (`eval`, `Function`, `vm.Script`) yok ya da sandboxed.
* Worker / child_process boundary’lerinde input validation ve IPC framing mevcut.
* Native addon varsa: boundary fuzz + ASAN/UBSAN run sonuçları.

## 2. Input Surface Hardening

Tracehound’un ana yüzeyi burası.

* Streaming parser’lar incremental ve bounded olmalı (no unbounded JSON.parse).
* Size, depth, recursion, entity expansion limitleri.
* Canonicalization: UTF-8 normalization, homoglyph, path traversal, mixed encoding.
* Content-type confusion ve polyglot payload testleri.
* Decompression bomb, zip-slip, archive traversal test artefaktları.
* Deterministic parsing guarantee (aynı input → aynı artifact hash).

## 3. Isolation & Containment

Quarantine iddiası teknik olarak ispatlanmalı.

* FS, network, process, env erişimi policy ile kapalı mı (seccomp, container profile, or Node permission model).
* Child execution varsa: no shell, argv escaping, uid/gid drop, chroot/container boundary.
* Temporary storage: no shared namespace, predictable path yok, secure deletion policy.
* Side-channel: timing, size, error message oracle azaltımı.

## 4. Cryptography & Integrity

Tracehound forensic substrate olduğu için integrity kritik.

* `crypto.randomBytes` dışında RNG yok.
* Hash seçimi: SHA-256/512, no MD5/SHA1.
* HMAC / signing kullanılıyorsa key rotation + constant-time compare.
* Artifact hash chain / tamper-evidence varsa collision ve truncation analizi.
* Secure serialization (canonical form → signed form).

## 5. Supply Chain & Build Reproducibility

* `npm audit` yeterli değil; lockfile immutability, `--frozen-lockfile`.
* Dependency reachability analizi (dead dep ≠ risk).
* Protestware / hijack detection (sigstore, npm provenance).
* Reproducible build + deterministic artifact hash.
* SBOM (CycloneDX) + dependency license & risk sınıflandırması.

## 6. DoS & Resource Exhaustion

Security buffer DoS’a düşerse model çöker.

* CPU: pathological input (regex, parser worst-case).
* Memory: bounded queues, backpressure, streaming only.
* File descriptors / handles leak test.
* Event-loop blocking audit (clinic flame, 99p latency).
* Algorithmic complexity attacks (hash flood, map/set abuse).

## 7. Observability Without Leakage

Forensic substrate olman nedeniyle log güvenliği kritik.

* No raw payload logging (redaction / tokenization).
* Structured log schema + PII class separation.
* Log injection / multiline break testleri.
* Crash dump / core dump sensitive data analizi.

## 8. Verification Artefacts (rapor için gerekli)

Aşağıdaki çıktılar hazır olmalı:

* Threat Model (DFD + trust boundary + attacker capability matrix).
* Attack Surface Enumeration (entrypoint, parser, syscall, dependency).
* Invariant List (ör: "no untrusted bytes reach business layer").
* Fuzz Report (coverage %, unique crash, minimized corpus).
* SAST + Semgrep rule pack sonucu (özelleştirilmiş Node security kuralları).
* Dependency Risk Report + SBOM.
* Resource Exhaustion test grafikleri.
* Crypto review (primitive + misuse analizi).
* Secure build & release flow (provenance, signing, hash).

## Fuzz ve otomasyon tarafı

Node projelerinde gerçek farkı bu yaratır:

* Jazzer.js / Fuzzilli (JS engine level) + libFuzzer via native boundary.
* Property-based tests (fast-check) → parser ve normalization invariant’ları.
* Differential fuzz (iki parser / iki canonicalizer karşılaştırması).
* Corpus: polyglot, mixed encoding, truncated, recursive, adversarial set.

## Tooling (pragmatik set)

* Semgrep (custom Node security rules)
* CodeQL
* npm-audit + osv-scanner
* Syft/Grype (SBOM)
* Jazzer.js
* fast-check
* clinic.js
* llnode
* node-report
* sigstore/cosign
* container seccomp/apparmor profile testleri.

## Rapor yapısı

Executive summary yazma; teknik başla.
Sistem modeli → trust boundaries → saldırgan modeli → yüzey → bulgular → kanıt → residual risk → hardening roadmap.
"No issue found" yazma; her zaman residual risk ve açık varsayım listesi bırak.
