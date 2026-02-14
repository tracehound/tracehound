# Supply Chain & Build Security

Auditors now examine this seriously.

Perform:

```
npm ls --all > /security/dependency-tree.txt
npm audit --json > /security/npm-audit.json
```

Additions:

- SBOM (CycloneDX or syft)
- Reproducible build hash
- Immutable lockfile
- Unused dependency reachability
- npm provenance / sigstore

Runtime SBOM enforcement significantly reduces supply-chain attacks.
