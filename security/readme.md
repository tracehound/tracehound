# Internal Audit Preparation

## Scope Documents

The audit package is built from these core documents:

- threat-model
- invariants
- attack-surface
- runtime-rce-audit
- fuzz-report
- isolation-model
- crypto-review
- supply-chain
- resource-exhaustion
- static-analysis
- logging-model
- residual-risk

## Expected Outcomes

A complete package should make the following visible:

- real attack surface map
- evidence gaps
- incorrect security assumptions
- exploitable boundaries
- likely auditor focus points

---

## Current Status

"Full cover Node security" is practically impossible. Risk can still be materially reduced when:

- invariants are proven with artifacts
- fuzz campaigns show no unresolved high-impact crashes
- RCE surface is minimized and justified
- isolation claims are split between code guarantees and deployment guarantees
- SBOM/build/provenance controls are in place

External audits most often find parser/model edge cases rather than structural flaws when the above controls are maintained.

[1]: https://arxiv.org/abs/2207.11171 'Silent Spring: Prototype Pollution Leads to Remote Code Execution in Node.js'
[2]: https://arxiv.org/abs/2306.13984 'HODOR: Shrinking Attack Surface on Node.js via System Call Limitation'
[3]: https://arxiv.org/abs/2508.13750 'NodeShield: Runtime Enforcement of Security-Enhanced SBOMs for Node.js'

## Execution Plan

A strong-maturity, near-full-closure program is tracked in:

- `security/artifacts/audit-program-3-sprints.md`

Program gates G1..G7 in that file define when external audit booking is allowed.

## Audit Package Checklist

- [ ] All documents updated from baseline to evidence-backed status.
- [ ] Artifact directories must be populated.
- [ ] Residual risk register finalized with owner + decision.
- [ ] Logging leakage checks and injection test results attached.
- [ ] Final review sign-off recorded in `security/artifacts/audit-package-checklist.md`.
