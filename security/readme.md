# Internal Audit Preparation

When these files are ready:

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

The following will be produced:

- real attack surface map
- evidence gaps
- incorrect security assumptions
- exploitable boundaries
- points likely to be identified by auditors (e.g., Cure53)

---

## Current Status

"Full cover Node security" is practically impossible. However:

- if invariants are proven
- if there are no fuzz crashes
- if the RCE surface is minimized
- if isolation is real
- if the SBOM + build are deterministic

External audits generally find model-edge and parser corner-cases, whereas structural vulnerabilities become rare.

[1]: https://arxiv.org/abs/2207.11171 'Silent Spring: Prototype Pollution Leads to Remote Code Execution in Node.js'
[2]: https://arxiv.org/abs/2306.13984 'HODOR: Shrinking Attack Surface on Node.js via System Call Limitation'
[3]: https://arxiv.org/abs/2508.13750 'NodeShield: Runtime Enforcement of Security-Enhanced SBOMs for Node.js'
