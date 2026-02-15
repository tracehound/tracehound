# Residual Risk

## Objective

Document explicit remaining risk after Audit baselines, without claiming absolute security.

## Security Assumptions

1. Deployment enforces runtime isolation controls (container policy, non-root, network/fs constraints).
2. Integrations provide accurate `scent.threat` signals where quarantine decisions depend on upstream detection.
3. CI security workflows (CodeQL/audit tooling) continue to run and are reviewed.

## Out-of-Scope / Partially Covered Attack Classes

| Class                                          | Scope Status                           | Note                                            |
| ---------------------------------------------- | -------------------------------------- | ----------------------------------------------- |
| Kernel/container breakout                      | Out of scope (platform responsibility) | Requires host/runtime hardening beyond app code |
| Supply-chain compromise in upstream registries | Partially covered                      | Reduced by lockfile/audit/SBOM, not eliminated  |
| Insider misuse of production secrets           | Partially covered                      | Requires IAM/process controls outside codebase  |
| Zero-day engine/runtime vulnerabilities        | Out of scope for app layer             | Mitigated only via patching/operations          |

## Open Invariant and Evidence Gaps

- Final invariant-to-artifact linkage is still incomplete.
- Fuzz coverage thresholds are defined, but final measured coverage report is pending.
- Key rotation lifecycle policy for webhook secret handling remains open.

## Residual Risk Register (Initial)

| ID    | Risk                                          | Current State                                               | Decision                                   | Owner          |
| ----- | --------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------ | -------------- |
| RR-01 | Misconfigured deployment isolation            | Code has declarative controls; hard enforcement is external | Accepted with operational controls         | Platform/SRE   |
| RR-02 | Future unsafe logging regression              | Policy defined; enforcement checks not fully automated yet  | Mitigate via checklist + CI lint follow-up | Security + App |
| RR-03 | Incomplete fuzz depth for edge cases          | Audit baseline prepared; execution evidence pending         | Mitigate in fuzz campaign completion       | Security       |
| RR-04 | Secret rotation ambiguity for webhook signing | Crypto baseline identifies gap                              | Mitigate via explicit rotation runbook     | Security + Ops |

## Exit Criteria

- Residual risk entries include decision + owner.
- Out-of-scope boundaries are explicit and reviewable.
- `security/artifacts/residual-risk-register.md` is published and reviewed.

## Sprint 3 Baseline Notes

- Draft residual risk register is now tracked in `security/artifacts/residual-risk-register.md` with owner, expiry, and review cadence.
