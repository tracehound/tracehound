# Memory / Buffer Security

## Objective

Review unsafe buffer operations and verify that binary parsing is bounded.

## Initial Findings

### `Buffer.allocUnsafe` usage — RESOLVED

All four `allocUnsafe` call sites in `packages/core/src/core/hound-ipc.ts` have been migrated to
`Buffer.alloc` (2026-03-07). No `allocUnsafe` remains in production IPC encoding paths.

Migrated call sites:

1. Length-prefixed frame buffer allocation (`encodeMessage`)
2. Status message payload allocation (`encodeHoundMessage` — status branch)
3. Metrics message payload allocation (`encodeHoundMessage` — metrics branch)
4. Analysis message payload allocation (`encodeHoundMessage` — analysis branch)

### Decision rationale

`Buffer.alloc` was chosen over the performance-focused `allocUnsafe` approach because:

- All buffers were fully written before return (no correctness risk), but future refactors could introduce partial writes that would silently expose heap memory.
- IPC encoding is not the performance bottleneck (OS pipe I/O dominates).
- Safer-by-default eliminates the entire class of uninitialized-memory disclosure from future refactors without measurable overhead.

## Verification Checklist

- [x] All `allocUnsafe` usages removed from IPC encoding paths.
- [x] Max frame size (`MAX_MESSAGE_SIZE = 1 MB`) enforced in `encodeMessage` and `tryParseMessage`.
- [x] Add lint rule to block future `allocUnsafe` introductions in `packages/core/src/` — grep guard added to `ci-pr.yml`, `ci-main.yml`, and `security-paranoid.yml`.

## Required Artifact

- `security/artifacts/buffer-audit-notes.md`

## Exit Criteria

- Every `allocUnsafe` usage has a written justification and matching test evidence.
- No unbounded binary parse path is left undocumented.
