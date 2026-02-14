# Core Engine Integrity Rules

## Evidence Lifecycle (Strict Order)

Evidence MUST follow this state machine. Skipping or reordering states is a CRITICAL BUG:

```
create (EvidenceFactory) -> insert (Quarantine) -> transfer/neutralize/evacuate -> dispose
```

- `create`: EvidenceFactory produces Evidence with hash + signature. Immutable once created.
- `insert`: Quarantine stores by signature. Duplicate check first.
- `transfer`: Ownership moves (e.g., to ColdStorage). Original reference invalidated.
- `neutralize`: Evidence marked as handled. Produces `NeutralizationRecord` for audit.
- `evacuate`: Emergency removal. Produces audit record.
- `dispose`: Terminal state. Accessing disposed evidence MUST return `EVIDENCE_DISPOSED` error.

Double-dispose, use-after-dispose, and transfer-after-neutralize are all forbidden states.

## AuditChain Hash Integrity

- Every entry references the previous entry's hash (genesis entry uses a fixed seed).
- `verify()` MUST walk the full chain. A single broken link = tamper detection alert.
- AuditChain is append-only. No delete, no update, no reorder.
- Hash algorithm: SHA-256 via Node.js `crypto`. No alternative implementations.

## Quarantine Rules

- Storage: `Map<ThreatSignature, EvidenceHandle>`. No alternative data structures.
- Eviction: Priority-based using `SEVERITY_RANK` (low=0, medium=1, high=2, critical=3). Lowest severity + oldest timestamp evicted first.
- Bounds: `maxCount` AND `maxBytes` enforced simultaneously. Both must be checked on insert.
- Duplicate detection: Same signature = duplicate. Return existing handle, do not replace.
- `flush()`: Removes all entries. Produces audit record for each removal.

## Agent Intercept Flow (Immutable)

The intercept pipeline order is FIXED and must not be rearranged:

1. Rate limit check -> `rate_limited`
2. Threat signal check -> `clean` (if no threat)
3. Payload validation + encoding -> `payload_too_large` / `error`
4. Signature generation (deterministic)
5. Duplicate check -> `ignored`
6. Evidence creation + quarantine insert -> `quarantined`

Adding steps between existing steps requires RFC approval.

## HoundPool Sandbox Constraints

Hound child processes operate under strict sandbox:

- NO `eval()`, `new Function()`, or dynamic code execution
- NO network access (no `http`, `https`, `net`, `dgram`, `dns`)
- NO filesystem writes (read-only access to own script only)
- NO access to parent process environment variables
- Communication: binary length-prefixed IPC over stdio ONLY
- Timeout: `maxProcessingTime` enforced. SIGTERM then SIGKILL.
- Crash recovery: pool auto-replenishes after `replenishDelay`.

## Rate Limiter Invariants

- Algorithm: Token bucket per source. Do not replace with sliding window or leaky bucket without RFC.
- Blocking: After `maxRequests` exhausted, source blocked for `blockDurationMs`.
- State: Bounded by TTL. Expired entries cleaned by Scheduler, not on-demand.
- Rate limiter runs BEFORE Agent. It is the first gate.

## Signature Determinism

- `generateSignature(input)` MUST be pure: same input = same output, always.
- Input is serialized via deterministic JSON (`serialize.ts`): sorted keys, no whitespace.
- No randomness, no timestamps, no counters in signature generation.

## Binary Codec Round-Trip

- `encode(data)` followed by `decode(encoded)` MUST produce byte-identical output.
- `encodeWithIntegrity()` adds SHA-256 hash. `decodeWithIntegrity()` MUST `verify()` BEFORE decode.
- Verify-before-decode is mandatory. Decoding unverified data is a security violation.
