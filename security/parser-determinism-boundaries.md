# Parser Determinism & Boundedness

## Why this matters

Since Tracehound acts as a security buffer, parser/serialization behavior must be deterministic and bounded.

## Determinism Rules

1. Canonical JSON key sorting before serialization.
2. SHA-256 hash over canonical UTF-8 bytes.
3. Signature format `${category}:${hash}`.
4. EvidenceFactory is single ownership point for hash/signature generation.

5. Payload JSON canonicalization: object keys sorted before serialization.
6. Hashing path: SHA-256 over canonical UTF-8 bytes.
7. Signature path: `${category}:${hash}` format.
8. Factory is single ownership point for hash/signature generation.

## Boundedness Rules

1. Reject ambiguous/non-serializable payload values.
2. Enforce size limit on encoded UTF-8 bytes.
3. Enforce depth (`32`) and width (`1000 keys/object`) limits.
4. IPC parser resets buffered state on malformed frame length errors.

## Bound Parameters

- `maxPayloadSize`: deployment-configured hard limit.
- Max nesting depth: `32`.
- Max object key count: `1000`.
- Max IPC frame size: `1MB`.

## Known Gaps

- [x] Dedicated fuzz and corpus evidence proving parser determinism under adversarial inputs.

## Actions

- [x] Deterministic property fuzz suite added (`packages/core/tests/fuzz/*.property.test.ts`).
- [x] Corpus replay test added (`packages/core/tests/fuzz/replay-corpus.test.ts`).
- [x] Artifact summary updated under `security/artifacts/`.
