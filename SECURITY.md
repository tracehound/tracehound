# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |
| < 1.0   | No        |

## Reporting a Vulnerability

If you discover a security vulnerability in Tracehound, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

### How to Report

1. Email: **<me@erdem.work>**
2. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Affected version(s)
   - Impact assessment (if possible)
   - Suggested fix (if any)

### Response Timeline

| Stage | SLA |
| ----- | --- |
| Acknowledgment | 48 hours |
| Initial assessment | 5 business days |
| Fix development | 30 days (critical), 90 days (others) |
| Public disclosure | After fix is released |

### What Happens Next

1. We acknowledge your report within 48 hours
2. We investigate and assess severity
3. We develop and test a fix
4. We release the fix and publish a security advisory
5. We credit you in the advisory (unless you prefer anonymity)

## Scope

### In Scope

- `@tracehound/core` — all modules
- `@tracehound/express` — middleware adapter
- `@tracehound/fastify` — plugin adapter
- `@tracehound/cli` — CLI tool
- Binary envelope format (THCS)
- Cryptographic operations (hashing, integrity verification)
- Process isolation (Hound sandboxing)
- Memory-bound guarantees (quarantine, rate limiter)

### Out of Scope

- Third-party dependencies (report to their maintainers)
- Denial of service via resource exhaustion against the host application
- Issues in draft/unreleased code on non-main branches
- Social engineering attacks

## Security Design

Tracehound's security architecture is documented in:

- [RFC-0000: Core Architecture](./docs/rfc/0000-Proposal.md) — Threat model and invariants
- [Fail-Open Specification](./docs/FAIL-OPEN-SPEC.md) — Failure mode guarantees
- [Evidence Lifecycle Policy](./docs/EVIDENCE-LIFECYCLE-POLICY.md) — Data handling
- [Cold Storage Security](./docs/COLD-STORAGE-SECURITY.md) — Storage integrity
- [Security Audit Roadmap](./docs/SECURITY-AUDIT.md) — Audit plan and recommendations

## Security Invariants

These properties are guaranteed and any violation is a security bug:

1. **Decision-Free**: Tracehound never makes threat detection decisions
2. **Payload-Less**: Raw payloads never escape the quarantine boundary
3. **Fail-Open**: Tracehound failures never block host application traffic
4. **Deterministic**: No ML or heuristics in the hot path
5. **Constant-Time**: All hash/signature comparisons use `crypto.timingSafeEqual`
6. **Memory-Bounded**: Every buffer, map, and collection has an explicit upper limit
7. **GC-Independent**: Security-critical cleanup is explicit, not garbage-collected
