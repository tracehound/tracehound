# Fuzz Assurance Program (External)

## Objective

Keep deterministic invariant assurance active while separating offensive corpus ownership from the public code repository.

## Current Ownership Model

The full fuzz assurance and corpus lifecycle is managed in the private repository:

- `tracehound/security-harness` (restricted SecOps access)

This repository no longer ships assurance gate scripts, nightly fuzz-assurance workflows, or local corpus files.

## What Still Runs in This Repository

- Core unit/integration tests (`pnpm --filter @tracehound/core test`)
- Deterministic chaos/invariant verification (`npm run test:chaos`)
- Static and CI controls (lint, coverage, CodeQL, Semgrep)

## Invariant Scope

Security invariants remain the same (determinism, bounded failure, integrity, non-amplification, IPC safety).  
The execution source for corpus replay and long-run assurance is now external.

## Evidence Contract

- This repository keeps architecture/security documentation.
- Corpus replay evidence and long-run assurance artifacts are produced in `tracehound/security-harness`.
- Public-repo references must not require private corpus files to run baseline CI.

## CI Policy

- PR CI in this repository must stay green without private corpus access.
- Nightly/extended corpus assurance is tracked by SecOps in the external harness pipeline.
