# Parser Determinism & Boundedness

## Why this matters

Since Tracehound acts as a security buffer, its parser/serialization behavior must be:

- **deterministic** (same input -> same signature)
- **bounded** (limited resource consumption)

## Current Determinism Rules

1. Payload JSON canonicalization: object keys sorted before serialization.
2. Hashing path: SHA-256 over canonical UTF-8 bytes.
3. Signature path: `${category}:${hash}` format.
4. Factory is single ownership point for hash/signature generation.

## Current Boundedness Rules

1. Payload structure validation rejects non-serializable/ambiguous values (`undefined`, `NaN`, `Infinity`, `function`, `symbol`, `bigint`).
2. Size control occurs after UTF-8 encoding using `maxPayloadSize`.
3. Agent maps size overflow to `payload_too_large` result.

## Bound Parameters

- `maxPayloadSize`: integration-configured hard limit (must be explicit in deployment config)
- Max nesting depth: hard-limited to `32` in encode validation path
- Max key count/object width: hard-limited to `1000` object keys per object

## Known Gaps

- [x] Explicit depth limit enforced (32).
- [x] Explicit width/object-key cardinality limit enforced (1000 keys/object).
- [ ] No dedicated fuzz artifact yet proving parser determinism under adversarial inputs.

## Actions

- [x] Default depth/width policy values proposed and implemented.
- [x] Deterministic test matrix includes key order, mixed encoding, deep nesting, and width overflow.
- [x] Create first artifact: `security/artifacts/parser-determinism-baseline.md`.
