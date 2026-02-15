# Fuzz & Adversarial Testing

## Objective

Define a repeatable fuzzing strategy for parser, codec, and IPC boundaries.

## Priority Fuzz Targets

1. Payload canonicalization and encoding path (`encodePayload`)
2. Binary codec encode/decode and integrity checks
3. IPC framing parser (`tryParseMessage` / parser feed logic)
4. Quarantine insertion and duplicate-handling behavior under malformed input

## Required Attack Cases

- malformed archive-like payloads
- polyglot payload patterns
- truncated IPC stream frames
- mixed encoding and unicode edge cases
- decompression bomb style inputs

## Campaign Requirements

| Area             | Minimum Requirement                           | Artifact                   |
| ---------------- | --------------------------------------------- | -------------------------- |
| Corpus           | Seed corpus + mutation strategy documented    | `fuzz-corpus-summary.md`   |
| Crash handling   | Crash count + minimized reproducer tracking   | `fuzz-crash-triage.md`     |
| Coverage         | Coverage trend (target modules)               | `fuzz-coverage-summary.md` |
| Invariant checks | Invariant break report (INV register linkage) | `fuzz-crash-triage.md`     |

## Tooling Plan

- Primary: property-based fuzzing (`fast-check`) for deterministic/invariant checks
- Optional extension: Jazzer.js/libFuzzer harnesses for binary-heavy targets

## Exit Criteria

- No unresolved high-severity crash in hot-path targets.
- Coverage and crash data are published under `security/artifacts/`.
- Fuzz findings are linked back to `security/invariants.md` and `security/parser-determinism-boundaries.md`.
