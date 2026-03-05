# Paranoid Validation Playbook

This playbook defines the highest-scrutiny validation path for Tracehound changes. It is intended for release candidates, security-sensitive refactors, and any change that touches runtime truth, process isolation, IPC, lifecycle cleanup, or public contracts.

The goal is not "tests passed." The goal is evidence that the change preserved deterministic runtime behavior, fail-open safety, and operational truth under adversarial conditions.

## Trigger Conditions

Run this playbook when any of the following are true:

- `packages/core/src/core/` changes
- snapshot integrity or CLI operational truth changes
- IPC, hound lifecycle, or process isolation changes
- typed error model or panic telemetry contract changes
- release preparation or publish-surface changes
- security review requests or regression suspicion

## Review Order

1. Diff-first attack-surface review
2. Automated validation
3. Negative-path and adversarial testing
4. Release artifact verification
5. Residual risk decision

## 1) Diff-First Attack-Surface Review

Review the diff before trusting any green test run.

Focus order:

- `packages/core/src/core/*`
- `packages/core/src/utils/system-snapshot.ts`
- `packages/cli/src/**/system-snapshot*`
- `packages/cli/src/commands/status.ts`
- `packages/cli/src/commands/stats.ts`
- `packages/cli/src/commands/watch.ts`
- `packages/core/src/index.ts`
- `docs/API.md`
- `docs/CONFIGURATION.md`
- `docs/BREAKING-CHANGES.md`

Mandatory questions:

- Can raw payload, secret material, or unsafe context escape the quarantine boundary?
- Did fail-open behavior degrade into fail-closed or silent crash?
- Can the CLI fabricate healthy state or zero-value state without verified runtime evidence?
- Did shutdown or error paths leave stale snapshot or stale health artifacts behind?
- Did a new uncategorized `Error` path bypass typed runtime error factories?
- Can child hounds inherit unnecessary environment variables or execution capability?
- Did public API or docs drift toward raw string literals instead of canonical helpers/constants?

## 2) Automated Validation

Minimum security gate:

```bash
pnpm lint
pnpm test
pnpm test:chaos
node scripts/release/verify-publish-packages.mjs
```

Coverage evidence:

```bash
pnpm test:coverage
```

The repository also carries scheduled security automation:

- `.github/workflows/ci-pr.yml`
- `.github/workflows/ci-main.yml`
- `.github/workflows/semgrep.yml`
- `.github/workflows/codeql-advanced.yml`
- `.github/workflows/security-paranoid.yml`
- `.github/workflows/release.yml`

## 3) Negative-Path and Adversarial Testing

Security-sensitive changes must prove the following categories:

### Operational Truth

- snapshot absent
- snapshot tampered
- snapshot stale
- snapshot future-dated
- shutdown cleanup failure
- CLI `NO_INSTANCE` and `INTEGRITY_VIOLATION` reporting

### IPC and Hound Isolation

- malformed frame
- partial frame
- oversized frame
- `complete` without `analysis`
- malformed `analysis`
- timeout, process crash, and pool exhaustion recovery
- environment allowlist enforcement

### Pressure and Lifecycle

- overload set and clear on `drop`
- overload set and clear on `defer`
- overload set and clear on `escalate`
- overload behavior on timeout/error
- planned shutdown without false panic escalation

### Contract and Documentation

- public exports available from package index
- typed panic reason patterns remain centralized
- docs/examples do not hard-code drift-prone literals
- release notes match actual runtime behavior

## 4) Release Artifact Verification

Do not publish from assumption. Publish only after pack verification evidence exists.

Run:

```bash
pnpm build
node scripts/release/verify-publish-packages.mjs
```

The verification script enforces:

- `dist/` exists
- publish allowlist is declared
- runtime entrypoints exist
- `npm pack --dry-run` succeeds
- source/test/coverage leaks do not enter the tarball

Artifacts are written to:

- `security/artifacts/generated/release-packages/*.json`

## 5) Residual Risk Decision

No release should close without an explicit decision on:

- what was proven
- what was inferred
- what remains unproven
- whether the residual risk is release-blocking

If any invariant cannot be demonstrated with evidence, treat it as open risk rather than assuming safety.

## CI/CD Mapping

### PR

- affected lint/build/test
- SBOM + vulnerability scan
- PR-safe secret scan
- Semgrep
- CodeQL

### main

- full workspace lint/build/test
- full-history secret scan

### Nightly / Manual Paranoid Run

- full lint/build/test
- coverage
- chaos suite
- publish-pack verification
- SBOM and production dependency audit

### Release

- manual trigger only
- explicit package selection
- full lint/build/test before publish
- publish only after version bump and clean main merge
