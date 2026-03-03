# Security Validation Harness

The offensive security testing infrastructure (Metasploit, OpenVAS/GVM,
adversarial harness, attack corpus, scan artifacts) has been moved to a
**separate, private repository** for supply-chain security reasons.

## Location

- Repository: [`tracehound/security-harness`](https://github.com/tracehound/security-harness.git)
- Access: Restricted to SecOps team members

## Why Separated

Security product repositories are high-value supply-chain targets.
Keeping offensive tools (Metasploit images, attack payloads, vulnerability
scan results) in the same repo as production code increases blast radius.

See: [Codecov breach (2021)](https://about.codecov.io/security-update/),
[ua-parser-js takeover (2021)](https://github.com/nicedoc/ua-parser-js/issues/536)

## What Remains Here

- `security/*.md` — Security review documentation (threat model, crypto review, etc.)
- `infrastructure/chaos/` — Defensive chaos testing (self-contained, no external tools)
- `.github/workflows/` — CodeQL, Semgrep, fuzz-assurance, chaos-verify (all defensive)
- `SECURITY.md` — Vulnerability disclosure policy
