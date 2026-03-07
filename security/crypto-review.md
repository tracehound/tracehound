# Crypto & Integrity Review

## Objective

Validate cryptographic usage for forensic integrity claims.

## Initial Findings

- Hashing currently uses SHA-256 (`createHash('sha256')`) in core utilities and audit chain.
- Constant-time comparison helper exists via `timingSafeEqual`.
- Random ID generation uses `crypto.randomBytes`.
- HMAC-SHA256 is used for webhook signing in notification emitter.
- Canonical serialization behavior is documented and used in hash/signature flow.

## Review Checklist

| Check                   | Current Observation                                | Status       |
| ----------------------- | -------------------------------------------------- | ------------ |
| RNG source              | `randomBytes` usage identified                     | Baseline set |
| Weak hashes (SHA1/MD5)  | No runtime SHA1/MD5 usage observed in core scan    | Baseline set |
| Constant-time compare   | `timingSafeEqual` wrappers present                 | Baseline set |
| Canonical serialization | deterministic key-sorted serialization path exists | Baseline set |
| Hash truncation         | full SHA-256 hex used in signature/hash paths      | Baseline set |
| Key rotation model      | Policy documented — see section below              | Documented   |

## Webhook Secret Key Rotation Policy

Enforcement point: `notification-emitter.ts` — HMAC-SHA256 signing, minimum 16-char secret required at construction time.

### Secret requirements

- Minimum 16 characters enforced at construction; recommended minimum is 32 random bytes (256-bit).
- Generate with `crypto.randomBytes(32).toString('hex')` — never a passphrase or human-readable string.
- Store in an environment variable or secrets manager (Vault, AWS SSM); never hardcode in source or config.

### Rotation triggers

- Suspected compromise or accidental exposure.
- Personnel change for anyone with secret access.
- Scheduled 90-day maximum rotation window.

### Rotation procedure

1. Generate new secret.
2. Update the consumer webhook endpoint configuration.
3. Update the secret in the environment / secrets manager.
4. Verify the next delivery signature against the new key.
5. Revoke the old secret.

Zero-downtime window: a brief dual-accept window is acceptable if needed; revoke the old key within 1 hour.

Audit trail: log rotation events with a key identifier or creation timestamp — never the secret value itself.

SSRF guard: `isAllowedWebhookUrl` blocks loopback, link-local, and RFC-1918 ranges.
Review SSRF coverage whenever a new endpoint type is added.

## Required Artifacts

- `crypto-integrity-checklist.md`
- key/secret rotation policy note for webhook integrations

## Exit Criteria

- All checklist rows have `verified` or `accepted risk` status with references.
- Any cryptographic assumption is mapped to code evidence and operational policy.
