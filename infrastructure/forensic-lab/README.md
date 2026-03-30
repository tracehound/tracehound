# tracehound forensic lab

Deterministic evidence and custody validation environment for Tracehound release candidates.

This package does not generate hostile traffic. It validates the forensic surface directly:

- signed snapshot write and verified readback
- CLI stale/future snapshot truth handling
- audit-chain continuity
- trace-registry bounded retention and drop behavior
- cold-storage write/read parity
- runtime membrane payload-egress blocking
- hound result custody continuity
- pressure transition evidence
- legacy snapshot compatibility

Run from the monorepo root:

```bash
pnpm --filter tracehound-forensic-lab build
node infrastructure/forensic-lab/dist/main.js --release local
```
