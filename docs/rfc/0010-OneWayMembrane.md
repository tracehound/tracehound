# RFC-0010: One-Way Membrane and Trace ID Signaling

## Title and Metadata

| Field | Value |
| --- | --- |
| RFC | 0010 |
| Status | Draft |
| Author | Tracehound Engineering |
| Created | 2026-03-03 |
| Updated | 2026-03-03 |
| Depends on | RFC-0000, RFC-0009 |
| Supersedes | None |
| Implemented in | TBD |

## Motivation

Roadmap source modules identify a repeated risk: payload bytes can become observable from runtime surfaces when integration boundaries drift. Tracehound needs a strict one-way membrane where runtime APIs expose metadata only, while forensic byte access remains confined to quarantine-local workflows. Developer diagnostics still need a deterministic handle that does not expose payload data.

Problems addressed:

1. Potential runtime payload egress via adapter or library response surfaces.
2. Lack of standardized non-payload diagnostic correlation key.
3. Ambiguous separation between runtime and forensic capability boundaries.

## Design

### Membrane Policy

1. Runtime contracts expose only metadata (`signature`, `severity`, timestamps, status metadata as allowed).
2. Raw bytes are never returned by runtime intercept APIs.
3. Forensic retrieval is a separate capability path and not part of request lifecycle.

### Trace ID Signaling (Design-Only in This Sprint)

Proposed response metadata behavior:

1. Adapters may emit `x-tracehound-trace-id` for quarantined outcomes.
2. Header value is a non-payload identifier and must not encode raw payload bytes.
3. Header emission is configuration-gated for privacy-sensitive environments.
4. Status code mapping remains unchanged (`403`, `429`, `413`, `500` fail-open handling).

### CLI Workflow Alignment

1. `tracehound inspect <trace-id>` resolves to local evidence metadata by identifier.
2. Default output remains redacted unless explicit forensic capability is available.
3. No runtime request handler gains payload-access capability via this flow.

## Security Considerations

1. Trust boundary: runtime application path is untrusted for evidence byte exposure.
2. Attack vector: trace-id enumeration. Mitigation: high-entropy IDs, optional TTL, and rate limiting on inspection endpoints.
3. Attack vector: accidental payload leakage through error contexts. Mitigation: strict metadata-only serialization policy.
4. Attack vector: capability confusion between runtime and forensic roles. Mitigation: explicit capability separation and negative tests.
5. Fail-open behavior: membrane enforcement failures must not block host; they must return safe status outcomes.

## Performance Impact

1. Metadata-only signaling minimizes response payload size.
2. Trace-id generation cost is constant-time and outside heavy payload processing.
3. No additional synchronous payload transformations are introduced in intercept hot path.
4. Any trace-id index/storage must be bounded by TTL and capacity.

## Backward Compatibility

1. No runtime behavior change is shipped in this governance sprint.
2. Future adapter additions (`x-tracehound-trace-id`) are additive and configuration-gated.
3. Existing status mapping remains normative and unchanged.
4. Integrations relying on payload visibility in runtime path are explicitly unsupported by design.

## Test Plan

1. Unit:
2. Runtime response contracts contain metadata only.
3. Trace-id generation uniqueness/format constraints.
4. Bounded trace-id registry behavior (capacity + TTL).
5. Integration:
6. Express/Fastify adapter emission behavior under configuration toggles.
7. CLI inspect trace-id resolution with redaction defaults.
8. Scenario:
9. High-throughput quarantined requests with concurrent trace-id lookup.
10. Membrane consistency under degraded coordination mode.
11. Security-negative:
12. Attempted raw payload extraction through runtime API.
13. Trace-id brute-force simulation and rate-limit verification.

## Alternatives Considered

1. Keep current runtime metadata only and avoid trace-id signaling.
2. Rejected because it weakens developer investigation ergonomics and increases pressure to bypass the membrane.
3. Return payload fragment previews in response body.
4. Rejected because it violates payload-less boundary and increases disclosure risk.
5. Expose trace identifiers derived directly from signatures.
6. Rejected because it can increase adversarial correlation of response data.
