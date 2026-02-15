# Isolation & Containment Proof

## Objective

Validate whether the "quarantine" claim is backed by real containment controls.

## Isolation Layers in Current Design

1. **Process separation**: hound analysis runs in child process via adapter.
2. **Protocol separation**: parent/child communication uses length-prefixed binary IPC.
3. **Timeout-based containment**: long-running workers can be terminated.
4. **Declarative constraints**: process constraints specify intended restrictions.

## Current Control Inventory

| Control Area              | Current Mechanism                              | Evidence Source                       | Assurance Level |
| ------------------------- | ---------------------------------------------- | ------------------------------------- | --------------- |
| Process boundary          | `spawn(...)`-based worker isolation            | `process-adapter.ts`, `hound-pool.ts` | Medium          |
| Code generation hardening | `--disallow-code-generation-from-strings`      | `process-adapter.ts`                  | Medium          |
| Prototype hardening       | `--disable-proto=throw`                        | `process-adapter.ts`                  | Medium          |
| Message boundary          | Length-prefixed parser with max message size   | `hound-ipc.ts`                        | Medium          |
| OS-level sandboxing       | Not enforced in Node itself (declarative only) | adapter comments and constraints      | Low             |

## Important Limitation

`networkAccess`, `fileSystemWrite`, and `childSpawn` constraints in the process adapter are **declarative intent** unless enforced by container/runtime policy. They are not hard guarantees by themselves.

## Required External Enforcement (Deployment)

- Container profile or runtime policy for filesystem/network isolation
- Privilege drop (non-root execution)
- Seccomp/AppArmor/SELinux profile where applicable
- Read-only filesystem for analysis worker when possible

## Evidence Plan

- [x] `security/artifacts/isolation-process-model.md` (baseline created)
- [x] `security/artifacts/container-policy-checklist.md` (baseline created)
- [x] `security/artifacts/hound-timeout-termination-check.md` (baseline created)

## Exit Criteria

- Isolation claim is split into:
  - **Implemented in code**
  - **Required from deployment environment**
- Every high-severity claim includes at least one verifiable artifact.
