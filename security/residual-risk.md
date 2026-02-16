# Residual Risk

## Objective

Document explicit remaining risk without claiming absolute security.

## Security Assumptions

1. Integrations provide accurate external threat signals.
2. CI security workflows continue to run and are reviewed.
3. Deployment hardening remains operational responsibility.

## Out-of-Scope / Partially Covered Attack Classes

| Class                                          | Scope Status                           | Note                                            |
| ---------------------------------------------- | -------------------------------------- | ----------------------------------------------- |
| Kernel/container breakout                      | Out of scope (platform responsibility) | Requires host/runtime hardening beyond app code |
| Supply-chain compromise in upstream registries | Partially covered                      | Reduced by lockfile/audit/SBOM, not eliminated  |
| Insider misuse of production secrets           | Partially covered                      | Requires IAM/process controls outside codebase  |
| Zero-day engine/runtime vulnerabilities        | Out of scope for app layer             | Mitigated only via patching/operations          |

## Open Invariant and Evidence Gaps

- No unresolved deterministic invariant failures are currently open.
- Long-running/nightly assurance stability is continuously monitored in CI.
- Key rotation lifecycle policy for webhook secret handling remains open.

## Residual Risk Register (Current)

| ID    | Risk                                          | Current State                                            | Decision                                   | Owner          |
| ----- | --------------------------------------------- | -------------------------------------------------------- | ------------------------------------------ | -------------- |
| RR-01 | Deployment isolation misconfiguration         | Filesystem/network/syscall controls are platform-managed | **Accepted (platform responsibility)**     | Platform/SRE   |
| RR-02 | Future unsafe logging regression              | Policy defined; enforcement checks partially automated   | Mitigate via checklist + CI lint follow-up | Security + App |
| RR-03 | Future fuzz depth drift as code evolves       | Jazzer-free invariant fuzz/corpus in CI, requires upkeep | Mitigate via nightly assurance ownership   | Security       |
| RR-04 | Secret rotation ambiguity for webhook signing | Crypto baseline identifies gap                           | Mitigate via explicit rotation runbook     | Security + Ops |

## Exit Criteria

- Residual risks include owner + decision.
- Out-of-scope boundaries remain explicit.
- Register in `security/artifacts/residual-risk-register.md` stays synchronized.
