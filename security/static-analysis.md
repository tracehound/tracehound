# Static & Semantic Security Scanning

## Objective

Establish automated static analysis with clear triage outcomes.

## Current State

- CodeQL workflow is present in GitHub Actions.
- CI already runs `pnpm audit --prod`.
- Semgrep and explicit taint-flow reporting are not yet documented as artifacts.

## Required Checks

1. CodeQL: prototype pollution, RCE surface, path traversal, unsafe process patterns
2. Semgrep: custom Node.js rules for dangerous sinks and insecure parsing patterns
3. Dependency reachability: focus on reachable vulnerable paths, not raw CVE counts
4. Taint flow: untrusted request input -> security-relevant sink mapping

## Triage Policy

| Severity      | Reachability         | Action                                 |
| ------------- | -------------------- | -------------------------------------- |
| Critical/High | Reachable            | Fix or block release                   |
| Critical/High | Unreachable (proven) | Document with proof and owner approval |
| Medium        | Reachable            | Time-boxed remediation plan            |
| Low           | Any                  | Backlog with periodic review           |

## Required Artifacts

- `semgrep-results.sarif`
- `codeql-summary.md`
- `taint-flow-notes.md`

## Exit Criteria

- All critical/high findings are triaged with explicit status.
- Reachability rationale is documented for accepted risks.
