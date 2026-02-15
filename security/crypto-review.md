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
| Key rotation model      | Not documented yet for webhook secret lifecycle    | Open         |

## Required Artifacts

- `crypto-integrity-checklist.md`
- key/secret rotation policy note for webhook integrations

## Exit Criteria

- All checklist rows have `verified` or `accepted risk` status with references.
- Any cryptographic assumption is mapped to code evidence and operational policy.
