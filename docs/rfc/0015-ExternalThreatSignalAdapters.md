# RFC: External Threat Signal Adapters

| Field          | Value                  |
| -------------- | ---------------------- |
| RFC            | 0015                   |
| Status         | Draft                  |
| Author         | Tracehound Engineering |
| Created        | 2026-03-10             |
| Updated        | 2026-03-10             |
| Depends on     | RFC-0000               |
| Supersedes     | None                   |
| Implemented in | TBD                    |

## Summary

This RFC defines an official adapter layer for ingesting explicit threat signals from external security systems into Tracehound.

The purpose of this layer is not detection. It does not classify traffic, infer maliciousness, or introduce heuristic threat decisions into core. Its role is narrower: it takes externally produced security verdicts and normalizes them into Tracehound’s existing `scent.threat` ingestion contract, while preserving enough source metadata for evidence integrity, audit chain continuity, and later forensic use.

This preserves Tracehound’s current architectural position: deterministic evidence processing for externally signaled suspicious traffic, with native guardrails such as rate limiting and payload size controls remaining separate concerns.

## Motivation

Tracehound already has a clear architectural boundary in principle, but not yet in its integration surface.

Core behaves deterministically:

- rate limiting is enforced before threat processing,
- if `scent.threat` is absent, the agent returns `clean`,
- if `scent.threat` is present, the agent enters evidence and quarantine processing.

This means Tracehound is not fully dependent on a WAF for all behavior, but its forensic evidence path still depends on an external threat signal producer.

At the same time, framework adapters such as Express collect request context and raw body data, but they do not provide an official mechanism for translating WAF or upstream detector metadata into `scent.threat`. That translation is effectively left to userland through `extractScent`.

This creates four problems.

First, integration is informal. There is no canonical way to ingest Cloudflare, AWS WAF, ModSecurity, NGINX App Protect, or similar upstream verdicts.

Second, conformance is ambiguous. Without a defined minimal `scent.threat` shape, cross-package adapter implementations cannot be validated consistently.

Third, forensic integrity is weaker than it should be. Even if a user maps headers into `scent.threat`, there is no standard for preserving source authority, raw upstream metadata, adapter version, or mapping provenance.

Fourth, the product boundary becomes harder to explain. Without a formal adapter layer, Tracehound can appear to rely on ad hoc integration even though its core model is stable.

This RFC resolves that by defining a formal external threat signal adapter model.

## Goals

The adapter layer must satisfy the following goals.

It must preserve the existing core philosophy. Core remains non-detecting and non-heuristic.

It must normalize explicit upstream verdicts into the existing ingestion model, especially `scent.threat`.

It must define a minimal, testable, core-facing threat contract.

It must preserve forensic source context needed for post-mortem analysis and auditability.

It must remain vendor-agnostic at the core boundary even if vendor-specific parsing exists inside adapters.

It must be deterministic. Given the same upstream metadata, the same normalized result must be produced.

It must be safe to fail closed toward “no threat mapping” rather than inventing a threat from incomplete or ambiguous input.

## Non-Goals

This RFC does not introduce a new detection engine.

It does not allow core to infer threats from request shape, payload entropy, parser anomalies, or similar heuristics.

It does not redefine native controls such as rate limiting or payload size rejection as threat intelligence.

It does not require every deployment to have a WAF. External adapters are optional. Native guardrails continue to function without them.

It does not introduce correlation, attribution, or threat intelligence enrichment beyond preserving upstream metadata.

## Current Model

Tracehound today can be described as follows.

There is a native guardrail surface. This includes controls such as rate limiting and payload-size-related refusal paths.

There is an external threat signal surface. The evidence and quarantine path depends on an explicit external signal represented as `scent.threat`.

There is an evidence substrate. Raw body and request context are already collected by adapters and can be used for evidence generation when the threat path is activated.

This RFC only formalizes the second part: external signal ingestion.

## Design Principles

The design follows five principles.

First, source authority is external. If a request is quarantined through this path, the threat claim originates outside Tracehound.

Second, normalization must not erase provenance. Every mapped signal must remain attributable to its upstream provider and adapter version.

Third, the adapter is translation, not interpretation. It may normalize a vendor score or rule hit into a common form, but it may not invent a malicious verdict from weak hints.

Fourth, normalized output should be minimal at the core boundary and rich at the forensic boundary. Core needs a stable threat object. Forensics may need more metadata.

Fifth, adapter output must be stable across time. Mapping changes should be versioned because they affect downstream evidence meaning.

## Proposed Architecture

The architecture introduces an explicit adapter layer between framework request capture and Tracehound core.

The processing model is:

incoming request
→ framework adapter captures request context and raw body
→ external signal adapter inspects upstream metadata
→ adapter produces normalized threat mapping and source metadata
→ `extractScent` includes the mapped `scent.threat`
→ core agent proceeds unchanged

This keeps the existing `Agent` flow intact. No change is required to the quarantine decision boundary in core.

## Adapter Categories

The adapter layer should support three source categories.

The first is edge WAF and CDN security providers. This includes systems such as Cloudflare or AWS edge-integrated products where verdicts are typically expressed through headers or upstream request metadata.

The second is reverse proxy and self-managed WAF systems. This includes ModSecurity, NGINX App Protect, or similar products where metadata may be surfaced through headers, variables, or proxy-side request augmentation.

The third is non-WAF external detectors. This includes bot management systems, abuse detection engines, or internal risk services that produce explicit request-level threat verdicts. This category matters because Tracehound should not become conceptually locked to WAFs even if WAFs are the most common source.

## Minimal `scent.threat` Contract

External signal adapters MUST map upstream security verdicts into the minimal core-facing `scent.threat` shape defined below.

```ts
export type ScentThreat = {
  source: 'external'
  provider: string
  decision: 'flagged' | 'blocked' | 'challenged' | 'allowed_with_signal'
  signal: string
  requestId?: string
  score?: number
  ruleIds?: string[]
}
```

Field requirements:

- `source` MUST be the constant value `'external'`.
- `provider` MUST identify the upstream authority that emitted the signal.
- `decision` MUST represent the normalized upstream verdict.
- `signal` MUST identify the specific upstream signal class used for mapping. Examples include `waf_rule_match`, `anomaly_score`, `bot_verdict`, or `managed_detector_hit`.
- `requestId` SHOULD contain the upstream request correlation identifier when available.
- `score` MAY be included only when the upstream provider exposes an explicit numeric score.
- `ruleIds` MAY be included when the upstream provider exposes one or more matched rule identifiers.

Adapters MUST NOT omit `provider`, `decision`, or `signal` when producing `scent.threat`.

Adapters MUST NOT add provider-specific semantics to `decision`. Provider-specific detail belongs in adapter metadata and evidence records, not in the normalized threat contract.

## Normalized Source Model

In addition to the minimal core-facing threat object, adapters SHOULD preserve a richer source model for evidence, audit chain, and later forensic analysis.

A conceptual normalized source shape may be represented as follows:

```ts
type ExternalThreatSignal = {
  source: {
    provider: string
    kind: 'waf' | 'proxy' | 'detector'
    adapterVersion: string
  }
  verdict: {
    decision: 'flagged' | 'blocked' | 'challenged' | 'allowed_with_signal'
    score?: number
    confidence?: number
    ruleIds?: string[]
    requestId?: string
  }
  metadata?: Record<string, string | number | boolean>
  rawSnapshot?: Record<string, string>
}
```

This richer model does not replace the required `ScentThreat` contract. It exists to preserve provenance and forensic context beyond what core needs for quarantine admission.

## Mapping Rules

Adapter mapping MUST be deterministic and conservative.

An adapter MAY produce `scent.threat` only when all of the following conditions are satisfied:

1. the upstream source is trusted under the deployment requirements defined in this RFC,
2. the adapter can identify the provider unambiguously,
3. the adapter can map the upstream signal into a valid `ScentThreat`,
4. the upstream input contains a clear suspicion-bearing verdict, challenge, managed rule hit, or equivalent deployment-approved signal.

Adapters MUST NOT synthesize `scent.threat` from incomplete, malformed, ambiguous, or purely informational upstream metadata.

Adapters MUST NOT infer maliciousness from generic telemetry such as the mere presence of a provider header, a request ID, or unrelated proxy metadata.

If a provider exposes a numeric score, score interpretation MUST remain provider-specific and versioned by the adapter. A score from one provider MUST NOT be treated as semantically equivalent to a score from another provider without explicit adapter policy.

If multiple upstream signals exist, adapter precedence MUST be explicit and documented. Conflicting providers MUST NOT be merged implicitly.

## Trust Boundary Requirements

Adapters that consume upstream request metadata MUST treat that metadata as authoritative only when all of the following deployment conditions are met:

1. **Trusted proxy enforcement**
   The application MUST run behind a trusted upstream proxy, edge provider, or gateway that is explicitly configured as the sole authority for the relevant security metadata.

2. **Direct-origin bypass prevention**
   Direct client access to the application origin MUST be blocked. Requests that bypass the trusted upstream layer MUST NOT be able to reach the adapter while still supplying spoofable upstream security headers.

3. **Header stripping and re-injection**
   Any headers used for threat mapping MUST be stripped from untrusted inbound traffic and re-injected only by the trusted upstream layer. The application MUST NOT trust client-supplied values for adapter-consumed security headers.

4. **Proxy identity validation**
   The deployment MUST validate that requests claiming upstream authority actually originated from the trusted proxy path. This MAY be established by network topology, authenticated proxying, private connectivity, or equivalent deployment controls.

5. **Deterministic trust configuration**
   The set of trusted upstream providers and the headers or variables they are allowed to supply MUST be explicitly configured. Adapters MUST NOT accept arbitrary provider claims from request metadata.

If any of these conditions are not met, the adapter MUST treat upstream metadata as untrusted and MUST NOT produce `scent.threat` from it.

## Raw Snapshot Policy

Adapters SHOULD preserve a bounded raw snapshot of upstream signal material.

This snapshot exists for forensic replay and auditability. It SHOULD include only the subset of upstream fields relevant to the signal mapping. Blindly dumping all headers is not desirable because it increases noise and may introduce privacy, storage, or compliance problems.

Recommended preserved fields include:

- the provider-specific request identifier,
- decision-related headers or variables,
- score or anomaly fields used by the mapping,
- rule identifiers when available.

The snapshot SHOULD be immutable once captured.

## Failure Modes

The adapter layer MUST define failure behavior clearly.

If the adapter cannot parse the upstream signal source, it MUST produce no threat mapping.

If the adapter encounters malformed provider data, it MUST produce no threat mapping and MAY emit an internal adapter error metric.

If a provider changes semantics in a backward-incompatible way, the adapter version MUST be bumped and the mapping rules updated explicitly.

If multiple providers provide conflicting signals, the deployment MUST choose a documented precedence policy rather than relying on accidental ordering.

A failure to map a threat is acceptable. A false mapping caused by ambiguous input is worse because it corrupts forensic meaning.

## Evidence Integration

When a mapped external threat exists, evidence generation SHOULD include:

- the normalized `ScentThreat` claim,
- the adapter source provider,
- the adapter version,
- the selected raw signal snapshot,
- the upstream request identifier when available.

This matters for later post-mortem workflows. It should be possible to connect a Tracehound evidence object back to an upstream provider request identifier, rule hit, or proxy correlation identifier.

This RFC does not define the full post-mortem schema, but it requires that adapter metadata be preserved in a form that future forensic and threat-intelligence modules can consume.

## Deployment Modes

This adapter model supports three deployment modes.

The first is baseline mode. No external adapter is configured. Native guardrails still operate, but no external threat mapping occurs.

The second is integrated mode. One or more upstream security systems are configured, and explicit threat verdicts are normalized into Tracehound.

The third is mixed mode. Native guardrails coexist with external signal ingestion. This already matches current practical behavior and remains valid.

## Example Adapter Interface

A minimal implementation shape is:

```ts
export type ScentThreat = {
  source: 'external'
  provider: string
  decision: 'flagged' | 'blocked' | 'challenged' | 'allowed_with_signal'
  signal: string
  requestId?: string
  score?: number
  ruleIds?: string[]
}

export type ExternalSignalAdapter = {
  provider: string
  kind: 'waf' | 'proxy' | 'detector'
  version: string
  map(input: {
    headers: Record<string, string | string[] | undefined>
    method: string
    path: string
    requestId?: string
  }): {
    threat?: ScentThreat
    metadata?: Record<string, unknown>
  }
}
```

`map()` MUST return either:

- no `threat`, meaning no compliant external threat mapping was possible, or
- a fully populated `ScentThreat` object that satisfies the contract defined in this RFC.

An adapter is compliant only if every non-empty threat mapping it emits is a valid `ScentThreat` object and only if it enforces the trust-boundary requirements in this RFC.

## Reference Integration with Express

The current Express package already exposes `extractScent`, which makes it the natural integration point.

The intended model is:

- the middleware captures request context and raw body,
- an external adapter runs inside user-provided `extractScent` or a helper around it,
- if a provider verdict is recognized, the adapter returns a threat object,
- the returned threat is attached to the scent,
- core proceeds unchanged.

This means the first implementation step does not require redesigning the middleware architecture. A package-level adapter helper is sufficient.

## Initial Vendor Targets

The first implementation wave SHOULD prioritize sources with simple and stable request-level metadata.

Cloudflare or similar edge security providers are reasonable first candidates because they typically expose durable request correlation identifiers and signal-friendly metadata.

A second wave can target reverse proxy and self-managed WAF systems such as ModSecurity and NGINX App Protect.

A third wave can cover non-WAF detectors, which is important for future-proofing the model.

The goal is not to support every vendor immediately. The goal is to define the contract once and validate it against one or two real integrations.

## Testing Requirements

Adapter tests MUST cover:

- deterministic mapping from representative upstream input to normalized threat output,
- non-mapping on incomplete or ambiguous inputs,
- snapshot preservation of relevant source fields,
- versioned behavior when provider semantics change,
- precedence behavior when multiple signal sources are present,
- refusal to map threat data when trust-boundary requirements are not satisfied.

Fixtures SHOULD be vendor-specific. Generic fake inputs are not sufficient because provider semantics differ materially.

## Security Considerations

The primary security risk in this design is false authority through spoofed upstream metadata.

For that reason, adapters MUST comply with the trust-boundary requirements defined in this RFC before treating upstream metadata as authoritative.

In particular, an adapter is non-compliant if it accepts threat-mapping headers from requests that can reach origin directly, from requests whose relevant headers were not stripped and re-injected by a trusted upstream layer, or from deployments that do not explicitly define trusted provider identity.

A secondary risk is excessive metadata preservation. Adapter raw snapshots SHOULD remain selective and MUST include only the fields necessary to explain the mapping and preserve forensic provenance.

## Compatibility

This RFC is intentionally backward-compatible with the current architectural model.

Core behavior does not change.

Framework adapters do not require fundamental redesign.

Existing deployments that manually set `scent.threat` can continue doing so.

The new adapter layer formalizes and standardizes what is already possible informally.

## Alternatives Considered

One alternative is to expand core so that it can derive its own threat decisions from request characteristics. This was rejected because it shifts Tracehound toward detection, weakens the forensic positioning, and increases product ambiguity.

Another alternative is to leave all upstream signal mapping entirely to userland. This was rejected because it creates inconsistent integrations and weakens provenance, auditability, and product clarity.

A third alternative is to treat all non-clean upstream telemetry as threat input. This was rejected because it encourages semantic inflation and weakens trust in evidence.

## Migration Path

The recommended rollout is incremental.

First, define the adapter contract and helper utilities.

Second, implement one reference adapter for a common provider.

Third, update documentation to distinguish clearly between native guardrails and external threat signal ingestion.

Fourth, add evidence metadata preservation for provider, adapter version, and raw signal snapshot.

Fifth, add conformance tests for future adapters.

## Open Questions

The exact storage location for rich adapter metadata in evidence records should be chosen carefully so it remains stable for future post-mortem and threat intelligence modules.

Multi-provider precedence should be explicit at deployment level. The contract should not silently merge conflicting threat authorities.

Score semantics should remain provider-specific. A forced global score model would be misleading.

## Conclusion

Tracehound should not expand its core into a detector.

The correct architectural move is to formalize an adapter layer for explicit external threat signals. This preserves the current philosophy, strengthens provenance, improves forensic quality, and creates a stable integration surface for WAFs and other upstream security systems.

That keeps the product on the forensic path while making its dependency on upstream threat authorities explicit, structured, and operationally usable.
