# Isolation & Containment Proof

## Objective

Describe containment behavior precisely without overstating security guarantees.

## Positioning

- **Process separation = fault containment**, not a hard security boundary.
- **Quarantine = logical state isolation**, not OS/process sandbox isolation.
- Application code does **not** claim kernel/container escape protection.

## Implemented in Code (Guaranteed by repository logic)

1. **Process separation for hound execution** via child process adapter.
2. **Timeout-based containment** for long-running workers.
3. **Bounded message protocol** with maximum IPC frame size checks.
4. **Runtime hardening flags** (`--disable-proto=throw`, `--disallow-code-generation-from-strings`) as risk-reduction controls.

## Not Guaranteed by Code (Out-of-scope for app-layer guarantees)

- Filesystem sandboxing guarantees
- Network sandbox/egress guarantees
- Syscall filtering guarantees (seccomp/AppArmor/SELinux)
- Privilege isolation guarantees (non-root enforcement)

## Current Control Inventory

| Control Area            | Current Mechanism                         | Evidence Source                       | Assurance Level |
| ----------------------- | ----------------------------------------- | ------------------------------------- | --------------- |
| Process boundary        | `spawn(...)`-based worker separation      | `process-adapter.ts`, `hound-pool.ts` | Medium          |
| Timeout containment     | terminate/kill flow for overrun workers   | `hound-pool.ts`, `process-adapter.ts` | Medium          |
| Message boundary        | Length-prefixed parser + max message size | `hound-ipc.ts`                        | Medium          |
| Runtime hardening flags | proto/codegen restriction flags           | `process-adapter.ts`                  | Medium          |
| OS-level sandboxing     | external to app code                      | platform policy                       | Not guaranteed  |

## External Hardening (Recommended, not correctness requirement)

- Container profile or runtime policy for filesystem/network isolation
- Privilege drop (non-root execution)
- Seccomp/AppArmor/SELinux profile where applicable
- Read-only filesystem for analysis worker when possible

## Evidence Plan

- [x] `security/artifacts/isolation-process-model.md` (baseline created)
- [x] `security/artifacts/container-policy-checklist.md` (baseline created)
- [x] `security/artifacts/hound-timeout-termination-check.md` (baseline created)

## Exit Criteria

- Isolation claims remain explicitly split between:
  - **Implemented in code**
  - **Not guaranteed / platform-managed**
- No statement implies kernel-level isolation guarantee from app code.
