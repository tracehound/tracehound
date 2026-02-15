# Supply Chain & Build Security

## Objective

Make dependency risk and build provenance auditable.

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
- Dependency exceptions require owner + expiry date
- Prioritize reachable vulnerabilities over transitive noise
- Track npm provenance / sigstore readiness for publish pipeline

## Exit Criteria

- Tree, audit, and SBOM artifacts are produced and versioned per run.
- Exceptions and accepted risks are documented with expiry.

## Sprint 3 Baseline Notes

- Dependency tree artifact is generated.
- `pnpm audit` endpoint returned 403 in this environment; output and error are captured in artifact.
- SBOM artifact is generated via local fallback generator due registry restrictions in `pnpm dlx` path.
