# Threat Model

## Scope

This model covers the open-source packages in this repository:

- `packages/core` (agent, quarantine, evidence lifecycle)
- `packages/fastify` and `packages/express` (request interception adapters)
- `packages/cli` (operator-facing inspection/status commands)

## System Model

### Assets

1. **Evidence integrity** (hash/signature determinism)
2. **Quarantine correctness** (no bypass for `scent.threat` flows)
3. **Availability** (bounded memory/queue/timeout behavior)
4. **Auditability** (append-only audit chain records)

### Trust Boundaries

- **Inbound request boundary**: Fastify/Express request object → `Scent`
- **Detector boundary**: `Scent.threat` is external input; Tracehound does not classify threats itself
- **Process boundary**: core process ↔ hound child process (`spawn` + IPC)
- **Storage boundary**: quarantine in-memory state and optional cold storage integration

The trust boundary model and defaults are implemented in `trust-boundary.ts` and should remain conservative by default.

## Data Flow (High Level)

```mermaid
flowchart LR
  A[Client Request / Event] --> B[Fastify/Express extractScent]
  B --> C[Agent.intercept]
  C --> D[RateLimiter.check]
  C --> E[EvidenceFactory.create]
  E --> F[encodePayload + SHA-256]
  C --> G[Quarantine.insert]
  G --> H[AuditChain.append]
  G --> I[HoundPool.activate]
  I --> J[Child Process Adapter spawn + IPC]
```

## Attacker Profiles

1. **Remote unauthenticated attacker**: sends crafted HTTP payloads to trigger bypass or DoS.
2. **Malicious integration input**: injects malformed `Scent` or untrusted detector output.
3. **Environment-level adversary**: abuses process spawning/OS capability assumptions.

## Key Assumptions (to validate in next audit)

- Node runtime flags used for child process reduce dynamic code-generation risk, but are not full sandboxing.
- Process constraints in adapter are declarative intent unless enforced by platform/container.
- Canonical serialization + hash path remains deterministic for equivalent inputs.

## Deliverables for This File

- [x] System model and trust boundaries documented
- [x] Data flow captured
- [ ] Per-boundary threat scenarios with test evidence links (`security/artifacts/`)
- [ ] Threat prioritization matrix (Likelihood x Impact)
