# Memory / Buffer Security

## Objective

Review unsafe buffer operations and verify that binary parsing is bounded.

## Initial Findings

### `Buffer.allocUnsafe` usage

`allocUnsafe` is used in `packages/core/src/core/hound-ipc.ts` for message encoding.

Current call sites:

1. Length-prefixed frame buffer allocation
2. Status message payload allocation
3. Metrics message payload allocation

### Safety rationale (current state)

These buffers are written immediately with deterministic fields before being returned.
No read-before-write pattern was identified in these paths.

### Risk note

`allocUnsafe` remains a sharp edge: future refactors can introduce partial writes or accidental exposure of uninitialized memory.

## Decisions Needed

- [ ] Decide whether to keep `allocUnsafe` (performance-focused) with strict guardrails, or
- [ ] migrate to `Buffer.alloc` for safer-by-default behavior in security-sensitive IPC code.

## Verification Checklist

- [ ] Add test asserting full buffer initialization for each IPC encode path.
- [ ] Add a lint/check rule or review checklist entry for new `allocUnsafe` usage.
- [ ] Document expected max frame size and reject behavior.

## Required Artifact

- `security/artifacts/buffer-audit-notes.md`

## Exit Criteria

- Every `allocUnsafe` usage has a written justification and matching test evidence.
- No unbounded binary parse path is left undocumented.
