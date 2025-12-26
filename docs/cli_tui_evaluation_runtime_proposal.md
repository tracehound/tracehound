# Tracehound – CLI + TUI Evaluation Runtime Proposal

## Status
Proposed

## Motivation

Cloud / Dashboard v2 deliberately postponed.
Product is closed-source, tiered subscription.
Still required: a **credible, hands-on evaluation surface** for first-time visitors.

Constraints:
- No source code exposure
- No SDK / middleware access
- No real integration
- Low effort, solo-developer friendly
- Correct enterprise signal (system-first, not UI-first)

This proposal defines a **CLI + TUI based Evaluation Runtime** as the official solution.

---

## High-Level Concept

Provide users with a **signed, time-limited binary** that exposes:

- Deterministic behavior
- Quarantine mechanics
- Audit chain integrity
- Resource pressure handling

…without exposing code, config, or integration points.

The runtime is **read-only, offline, and non-integrable** by design.

---

## Why CLI + TUI (and not Electron)

Electron is explicitly rejected due to:

- High development and maintenance cost
- Security surface expansion
- False UI-first product signal
- Long-term refactor debt

CLI + TUI provides:

- Minimal surface area
- Deterministic behavior
- Native fit for runtime/security tooling
- Very low ongoing maintenance

---

## Technology Stack

| Layer | Tool | Reason |
|------|------|--------|
| CLI  | Commander.js | Industry-standard argument parsing |
| TUI  | Ink (React-based) | Familiar mental model, terminal renderer |
| Lang | TypeScript | Existing codebase alignment |

---

## User-Facing Commands

```bash
tracehound eval snapshot
tracehound eval watch
tracehound eval scenario <name>
```

### eval snapshot
- Single-shot, plain CLI output
- Suitable for logs, screenshots, CI demos

### eval watch
- Live terminal UI
- Periodic snapshot refresh (e.g. 1s)
- Panels only, no interaction

### eval scenario
- Deterministic, pre-defined simulations
- No external input

---

## TUI Layout (Conceptual)

```
┌─ Quarantine ──────────────┐ ┌─ Hound Pool ───────────┐ ┌─ Audit ───────────┐
│ entries     : 1203        │ │ active   : 2           │ │ records : 1203     │
│ critical    : 12          │ │ dormant  : 4           │ │ integrity: VALID   │
│ evicted low : 742         │ └───────────────────────┘ └───────────────────┘
└───────────────────────────┘
```

Properties:
- Read-only
- Stateless between runs
- No payload visibility

---

## Internal Architecture

```
cli/
├─ index.ts              # Commander entrypoint
├─ commands/
│  ├─ snapshot.ts
│  └─ watch.ts
└─ tui/
   ├─ App.tsx            # Ink root
   ├─ panels/
   │  ├─ Quarantine.tsx
   │  ├─ HoundPool.tsx
   │  └─ Audit.tsx
   └─ hooks/
      └─ useSnapshot.ts
```

- CLI commands call the same snapshot API
- TUI is just a refresh loop over snapshot()
- No coupling to core internals beyond readonly access

---

## Evaluation Runtime Guarantees

Starter / Evaluation binaries:

- No external network I/O
- No config mutation
- No plugin system
- No adapters (Express/Fastify/etc.)
- No payload or evidence bytes exposed

This ensures **demonstration, not deployment**.

---

## Licensing & Expiry

- Time-limited evaluation (7–14 days)
- Expiry embedded in binary
- Graceful shutdown on expiration

```
Evaluation period expired.
This runtime can no longer intercept or quarantine.
```

---

## What This Is NOT

- Not a dashboard
- Not a SaaS UI
- Not a monitoring tool
- Not an integration surface

This is an **evaluation artifact**, not a product tier.

---

## Benefits

- Protects IP
- Minimal engineering overhead
- Correct enterprise positioning
- Clear upgrade boundary
- No long-term UI debt

---

## Next Steps

1. Commit proposal to repo (`docs/proposals/cli-tui-eval.md`)
2. Implement mock snapshot + Ink layout
3. Wire snapshot to real readonly core state
4. Package signed evaluation binaries

---

## Summary

CLI + TUI Evaluation Runtime is the lowest-effort, highest-signal way to:

- Show Tracehound behavior
- Preserve closed-source integrity
- Avoid premature dashboard work
- Stay aligned with system-first philosophy

This approach is intentionally boring — and therefore correct.

