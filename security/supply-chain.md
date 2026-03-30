# Supply Chain & Build Security

## Objective

Make dependency risk and build provenance auditable without expanding the release trust boundary.

## Release Trust Boundary

Trusted release input for `v1.8.9` is:

1. Immutable `pnpm-lock.yaml`
2. Offline/clean dependency install
3. `tsc-first` workspace build
4. `npm pack` parity verification
5. Release manifest/hash metadata

The following remain outside trusted release provenance and are treated as replaceable tooling layers:

- `vite`
- `vitest`
- `tsx`
- optional bundlers such as `esbuild`

These tools may still be used for testing, local workflows, or packaging convenience, but they do not define what is published.

## Baseline Controls

- Lockfile exists (`pnpm-lock.yaml`)
- CI executes production dependency audit (`pnpm audit --prod`)
- CodeQL workflow is active for repository scanning

## Required Outputs

| Output                | Command / Source                | Artifact                                            |
| --------------------- | ------------------------------- | --------------------------------------------------- |
| Full dependency tree  | `pnpm list -r --depth Infinity` | `security/artifacts/dependency-tree.txt`            |
| Vulnerability report  | `pnpm audit --json`             | `security/artifacts/pnpm-audit.json`                |
| SBOM                  | CycloneDX/syft generation       | `security/artifacts/sbom.cdx.json`                  |
| Reproducibility notes | build hash comparison procedure | `security/artifacts/build-reproducibility-notes.md` |

## Policy Requirements

- Immutable lockfile in CI for release branches
- Offline install for release verification jobs
- Source-to-artifact parity must be emitted per package with release label, commit SHA, executedAt, build mode, and source path
- Dependency exceptions require owner + expiry date
- Prioritize reachable vulnerabilities over transitive noise
- Track npm provenance / sigstore readiness for publish pipeline

## Gate Split

- Release gate: lockfile, install provenance, `pnpm build`, package verification, release manifest output
- Security/tooling gate: unit tests, coverage, chaos, forensic lab, SBOM, audit, license and CVE triage

## Exit Criteria

- Tree, audit, SBOM, and release-package manifest artifacts are produced and versioned per run.
- Exceptions and accepted risks are documented with expiry.

## Sprint 3 Baseline Notes

- Dependency tree artifact is generated.
- `pnpm audit` endpoint returned 403 in this environment; output and error are captured in artifact.
- SBOM artifact is generated via local fallback generator due to registry restrictions in `pnpm dlx` path.
- Release package verification now emits package-level metadata with `release`, `artifactSource`, `buildMode`, `commitSha`, `executedAt`, and `sourcePath`.
