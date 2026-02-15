# Logging without Leakage

## Objective

Ensure observability supports forensics without leaking sensitive input data.

## Logging Risk Areas

1. Raw payload/body logging in adapters or middleware
2. PII or secret leakage in structured logs
3. Log injection via untrusted fields (newline/control char abuse)
4. Sensitive data exposure in error traces or crash dumps

## Baseline Logging Policy

| Rule ID | Rule                                                                                     | Rationale                                           |
| ------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------- |
| LOG-01  | Never log raw request payloads by default                                                | Prevent accidental sensitive-data disclosure        |
| LOG-02  | Redact known sensitive fields (`authorization`, `cookie`, `token`, `password`, `secret`) | Minimize credential leakage                         |
| LOG-03  | Normalize untrusted text before logging (strip/escape control chars)                     | Prevent log injection and parser confusion          |
| LOG-04  | Separate forensic identifiers from user content                                          | Keep investigation utility without payload exposure |
| LOG-05  | Keep retention and access policies explicit for security logs                            | Reduce long-term exposure blast radius              |

## Verification Plan

- [x] Search code paths for risky logging patterns (`console.*`, logger sinks, webhook failure logs) → `security/artifacts/logging-scan-rg.txt`
- [x] Create redaction checklist with examples (`security/artifacts/logging-redaction-checklist.md`)
- [ ] Execute log injection test cases and record outcomes (`security/artifacts/log-injection-test-results.md`)
- [x] Run sensitive-string scan against crash/error outputs (`security/artifacts/crash-dump-sensitive-scan.md`)

## Exit Criteria

- Logging policy and enforcement points are documented.
- No unresolved high-severity leakage path remains in default configuration.
- Artifacts for redaction, injection tests, and dump scans are present.
