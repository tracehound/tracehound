# Dynamic Execution & RCE Surface

## Objective

Establish a repository-specific RCE surface map and define what is currently prevented vs. still open.

## Scope

- `packages/core`
- `packages/fastify`
- `packages/express`
- `packages/cli`

## Initial Code Scan Summary

### Dynamic code execution primitives

- `eval(...)`: **not found in runtime packages**
- `new Function(...)`: **not found in runtime packages**
- `vm.*`: **not found in runtime packages**
- `dynamic import(...)`: present in tests/CLI patterns, but no unsafe runtime code-loading mechanism was identified in core hot path

### Process execution primitives

- `node:child_process` usage is present in `packages/core/src/core/process-adapter.ts`
- Process creation is done through `spawn(process.execPath, [...execArgv, scriptPath])`
- Security-related runtime flags are applied to child process startup:
  - `--disable-proto=throw`
  - `--disallow-code-generation-from-strings`

## RCE-Relevant Trust Boundaries

1. **Inbound untrusted payload** (Express/Fastify request)
2. **Detector boundary** (`scent.threat` is externally supplied classification)
3. **Child process boundary** (core -> hound process via IPC)
4. **Script path boundary** (`processScriptPath` in hound pool config)

## Risk Register

| ID     | Surface                     | Current State                            | Risk                                                      | Priority |
| ------ | --------------------------- | ---------------------------------------- | --------------------------------------------------------- | -------- |
| RCE-01 | Runtime JS code generation  | Hardening flags applied to child process | Parent process policy not centrally asserted              | Medium   |
| RCE-02 | Child process spawn         | Explicit `spawn` usage for hound worker  | Misconfigured script path could execute unintended code   | High     |
| RCE-03 | Prototype pollution -> sink | No direct eval/vm sink found             | Pollution may still influence object behavior paths       | High     |
| RCE-04 | Dynamic imports             | Mostly test/tooling usage                | Future plugin/runtime loading could expand attack surface | Medium   |

## Required Evidence

- [ ] Add grep/ripgrep command outputs under `security/artifacts/rce-scan.txt`
- [ ] Add a reviewed list of all `spawn` call sites with owner sign-off
- [ ] Confirm `processScriptPath` safety expectations in deployment docs
- [ ] Add prototype-pollution-focused review notes (source -> sink reasoning)

## Exit Criteria

- All RCE-01..RCE-04 items have status (`open`, `mitigated`, `accepted risk`).
- All process execution call sites are explicitly documented.
