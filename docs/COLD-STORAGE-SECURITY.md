# Cold Storage Security Specification

> **Version:** 1.0
> **Status:** Normative
> **Applies to:** @tracehound/core v1.1.0+ (Pro/Enterprise)

---

## Overview

Cold Storage is the long-term archival layer for evidence. This document specifies security requirements for production adapters (S3, R2, GCS).

---

## Transport Security

### mTLS Requirement (Enterprise)

| Tier       | Transport | Certificate       |
| ---------- | --------- | ----------------- |
| Pro        | TLS 1.3   | Provider-managed  |
| Enterprise | mTLS      | Customer-provided |

### Enterprise mTLS Configuration

```typescript
interface ColdStorageTLSConfig {
  // Client certificate for mutual TLS
  clientCert: string | Buffer
  clientKey: string | Buffer

  // CA bundle for server verification
  caCert?: string | Buffer

  // Minimum TLS version
  minVersion: 'TLSv1.3'
}
```

---

## Encryption at Rest

### Requirements

| Storage | Encryption        | Key Management        |
| ------- | ----------------- | --------------------- |
| S3      | SSE-S3 or SSE-KMS | AWS-managed or CMK    |
| R2      | Automatic         | Cloudflare-managed    |
| GCS     | Default or CMEK   | Google-managed or CMK |

### Customer-Managed Keys (Enterprise)

```typescript
interface EncryptionConfig {
  // Key type
  type: 'provider-managed' | 'customer-managed'

  // For customer-managed keys
  keyId?: string // KMS key ID / ARN

  // Key rotation policy
  rotationDays?: number // Default: 90
}
```

---

## Integrity Verification

### SHA-256 Hash Chain

All evidence is hashed before storage:

```typescript
// Before write
const encoded = encodeWithIntegrity(evidence.bytes)
// encoded.hash = SHA-256 of payload

// On read
const verified = verify(encoded)
// Throws if hash mismatch
```

### Tamper Detection

```
┌─────────────────────────────────────────────────────────────┐
│  If verify() fails → Evidence is COMPROMISED               │
│  Log to AuditChain, alert, DO NOT process                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Access Control

### Principle of Least Privilege

| Operation | Permission                          |
| --------- | ----------------------------------- |
| write()   | `s3:PutObject` only                 |
| read()    | `s3:GetObject` only                 |
| delete()  | `s3:DeleteObject` (gated by policy) |

### Recommended IAM Policy (AWS)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::tracehound-evidence/*"
    }
  ]
}
```

---

## Key Rotation Policy

| Tier       | Rotation               | Enforcement    |
| ---------- | ---------------------- | -------------- |
| Pro        | Provider-default       | Automatic      |
| Enterprise | 90 days (configurable) | Documented SOP |

### Rotation Procedure

1. Generate new key in KMS
2. Update adapter config
3. Re-encrypt existing evidence (optional)
4. Deactivate old key after grace period

---

## Audit Trail

All Cold Storage operations are logged to AuditChain:

```typescript
interface ColdStorageAuditEvent {
  action: 'write' | 'read' | 'delete'
  evidenceId: string
  timestamp: number
  success: boolean
  error?: string
}
```

---

## Related Documents

- [FAIL-OPEN-SPEC.md](./FAIL-OPEN-SPEC.md) — Failure behavior
- [PERFORMANCE-SLA.md](./PERFORMANCE-SLA.md) — Latency guarantees
- [LOCAL-STATE-SEMANTICS.md](./LOCAL-STATE-SEMANTICS.md) — Instance isolation
