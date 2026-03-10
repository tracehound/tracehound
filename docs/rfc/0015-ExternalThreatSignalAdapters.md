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

The purpose of this layer is not detection. It does not classify traffic, infer maliciousness, or introduce heuristic threat decisions into core. Its job is narrower: take externally produced security verdicts and normalize them into Tracehound’s existing `scent.threat` ingestion contract, while preserving enough source metadata for evidence, audit chain integrity, and later forensic use.

This keeps Tracehound aligned with its current architectural position: deterministic evidence processing for externally signaled suspicious traffic, with native guardrails such as rate limiting and payload size controls remaining separate concerns.

## Motivation

Tracehound currently has a clear separation in principle, but not yet in integration surface.

The core agent already behaves deterministically:

- rate limiting is enforced before threat processing,
- if `scent.threat` is absent, the agent returns `clean`,
- if `scent.threat` is present, the agent enters evidence/quarantine processing.

This means Tracehound is not fully dependent on a WAF for all behavior, but its forensic evidence path still depends on an external threat signal producer.

At the same time, framework adapters such as Express currently collect request context and raw body data, but they do not provide an official mechanism for translating WAF or upstream detector metadata into `scent.threat`. That translation is effectively left to userland through `extractScent`.

This creates three problems.

First, integration is informal. There is no canonical way to ingest Cloudflare, AWS WAF, ModSecurity, NGINX App Protect, or similar verdicts.

Second, forensic integrity is weaker than it should be. Even if a user maps headers into `scent.threat`, there is no standard for preserving source authority, raw upstream metadata, adapter version, or mapping provenance.

Third, the product boundary becomes harder to explain. Without a formal adapter layer, Tracehound can appear to rely on ad hoc integration even though its core model is stable.

This RFC fixes that by defining a formal external signal adapter model.

## Goals

The adapter layer must satisfy the following goals.

It must preserve the existing core philosophy. Core remains non-detecting and non-heuristic.

It must normalize explicit upstream verdicts into the existing ingestion model, especially `scent.threat`.

It must preserve forensic source context needed for post-mortem analysis and auditability.

It must remain vendor-agnostic at the core boundary even if vendor-specific parsing exists inside adapters.

It must be deterministic. Given the same upstream metadata, the same normalized result must be produced.

It must be safe to fail closed toward “no threat mapping” rather than inventing a threat from incomplete or ambiguous inputs.

## Non-Goals

This RFC does not introduce a new detection engine.

It does not allow core to infer threats from request shape, payload entropy, parser anomalies, or similar heuristics.

It does not redefine native controls such as rate limiting or payload size rejection as threat intelligence.

It does not require every deployment to have a WAF. External adapters are optional. Native guardrails continue to function without them.

It does not introduce correlation, attribution, or threat intelligence enrichment beyond preserving upstream metadata.

## Current Model

Tracehound today can be described as follows.

There is a native guardrail surface. This includes controls such as rate limiting and payload-size-related refusal paths.

There is an external threat signal surface. The evidence/quarantine path depends on an explicit external signal represented as `scent.threat`.

There is an evidence substrate. Raw body and request context are already collected by adapters and can be used for evidence generation when the threat path is activated.

This RFC only formalizes the second part: external signal ingestion.

## Design Principles

The design follows five principles.

First, source authority is external. If a request is quarantined through this path, the threat claim originates outside Tracehound.

Second, normalization must not erase provenance. Every mapped signal must remain attributable to its upstream provider and adapter version.

Third, the adapter is translation, not interpretation. It may normalize a vendor score or rule hit into a common form, but it may not invent a malicious verdict from weak hints.

Fourth, normalized output should be minimal at the core boundary and rich at the forensic boundary. Core needs a stable threat object. Forensics may need much more metadata.

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

The third is non-WAF external detectors. This includes bot management systems, abuse detection engines, or internal risk services that produce explicit request-level threat verdicts. This category is important because Tracehound should not become conceptually locked to WAFs even if WAFs are the most common source.

## Normalized Model

The external adapter should produce two things.

The first is the existing core-facing threat object that becomes `scent.threat`.

The second is a richer forensic source object retained for evidence, audit chain, and later analysis.

A reference normalized shape can be described like this:

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

This is not necessarily the exact public TypeScript contract to expose in core. It is the conceptual normalization target at the adapter boundary.

The final mapped `scent.threat` should be as small as the current core requires. The rest belongs to evidence metadata and audit records.

## Minimal `scent.threat` Contract

External signal adapters MUST map upstream security verdicts into the minimal
core-facing `scent.threat` shape defined below.

```ts
type ScentThreat = {
  source: 'external'
  provider: string
  decision: 'flagged' | 'blocked' | 'challenged' | 'allowed_with_signal'
  signal: string
  requestId?: string
  score?: number
  ruleIds?: string[]
}
```

## Field requirements

- `source` MUST be the constant value `'external'`.
- `provider` MUST identify the upstream authority that emitted the signal.
- `decision` MUST represent the normalized upstream verdict.
- `signal` MUST identify the specific upstream signal class used for mapping. Examples include `waf_rule_match`, `anomaly_score`, `bot_verdict`, or `managed_detector_hit`.
- `requestId` SHOULD contain the upstream request correlation identifier when available.
- `score` MAY be included only when the upstream provider exposes an explicit numeric score.
- `ruleIds` MAY be included when the upstream provider exposes one or more matched rule identifiers.

Adapters MUST NOT omit `provider`, `decision`, or `signal` when producing `scent.threat`.

Adapters MUST NOT add provider-specific semantics to decision. Provider-specific detail belongs in adapter metadata and evidence records, not in the normalized threat contract.

A few notes on why this shape is the right minimum:

`source: 'external'` gives explicit authority origin.
`provider` is necessary for provenance.
`decision` is the normalized action class.
`signal` prevents the object from becoming semantically empty. Without it, two threats from the same provider can look identical while coming from totally different upstream reasons.
`requestId`, `score`, and `ruleIds` are optional but operationally important.

This is enough for conformance tests without turning `scent.threat` into a forensic blob.

---

## Revised adapter interface

Then update the interface section so it no longer returns `unknown`.

```md
## Example Adapter Interface

A minimal implementation shape is:

```ts
type ScentThreat = {
  source: 'external'
  provider: string
  decision: 'flagged' | 'blocked' | 'challenged' | 'allowed_with_signal'
  signal: string
  requestId?: string
  score?: number
  ruleIds?: string[]
}

type ExternalSignalAdapter = {
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

map() MUST return either:

- no threat, meaning no compliant external threat mapping was possible, or
- a fully populated ScentThreat object that satisfies the contract defined in this RFC.

## Mapping Rules

Adapter mapping MUST be deterministic and conservative.

An adapter MAY produce `scent.threat` only when all of the following conditions
are satisfied:

1. the upstream source is trusted under the deployment requirements defined in
   this RFC,
2. the adapter can identify the provider unambiguously,
3. the adapter can map the upstream signal into a valid `ScentThreat`,
4. the upstream input contains a clear suspicion-bearing verdict, challenge,
   managed rule hit, or equivalent deployment-approved signal.

Adapters MUST NOT synthesize `scent.threat` from incomplete, malformed,
ambiguous, or purely informational upstream metadata.

Adapters MUST NOT infer maliciousness from generic telemetry such as the mere
presence of a provider header, a request ID, or unrelated proxy metadata.

If a provider exposes a numeric score, score interpretation MUST remain
provider-specific and versioned by the adapter. A score from one provider MUST
NOT be treated as semantically equivalent to a score from another provider
without explicit adapter policy.

## `scent.threat` Contract Strategy

The preferred strategy is to keep the current core contract unchanged.

The adapter should translate external signals into the exact threat shape expected by existing core behavior. Any richer context should be attached outside the minimal threat claim, typically under request-scoped metadata used later by evidence generation.

This matters because the purpose of the RFC is to formalize ingestion, not to reopen the core’s philosophical boundary.

## Trust Model

The adapter layer creates a trust boundary. That boundary must be explicit.

Tracehound does not independently verify whether the upstream verdict is correct. It trusts the upstream source as an authority for suspicion.

However, Tracehound must preserve enough provenance so that post-mortem analysis can answer:

which provider emitted the signal,
which adapter version mapped it,
which raw upstream metadata was observed,
which fields were used to produce the mapped threat.

This trust model is appropriate for a forensic product. Tracehound does not claim that the threat verdict is true in a universal sense. It claims that a recognized upstream authority emitted a signal and that the signal was deterministically preserved and processed.

## Trust Boundary Requirements

Adapters that consume upstream request metadata MUST treat that metadata as
authoritative only when all of the following deployment conditions are met:

1. **Trusted proxy enforcement**
   The application MUST run behind a trusted upstream proxy, edge provider, or
   gateway that is explicitly configured as the sole authority for the relevant
   security metadata.

2. **Direct-origin bypass prevention**
   Direct client access to the application origin MUST be blocked. Requests that
   bypass the trusted upstream layer MUST NOT be able to reach the adapter while
   still supplying spoofable upstream security headers.

3. **Header stripping and re-injection**
   Any headers used for threat mapping MUST be stripped from untrusted inbound
   traffic and re-injected only by the trusted upstream layer. The application
   MUST NOT trust client-supplied values for adapter-consumed security headers.

4. **Proxy identity validation**
   The deployment MUST validate that requests claiming upstream authority
   actually originated from the trusted proxy path. This MAY be established by
   network topology, authenticated proxying, private connectivity, or equivalent
   deployment controls.

5. **Deterministic trust configuration**
   The set of trusted upstream providers and the headers or variables they are
   allowed to supply MUST be explicitly configured. Adapters MUST NOT accept
   arbitrary provider claims from request metadata.

If any of these conditions are not met, the adapter MUST treat upstream metadata
as untrusted and MUST NOT produce `scent.threat` from it.

## Raw Snapshot Policy

Adapters should preserve a bounded raw snapshot of upstream signal material.

This snapshot exists for forensic replay and auditability. It should include only the subset of upstream fields relevant to the signal mapping. Blindly dumping all headers is not desirable because it increases noise and may introduce privacy or compliance issues.

The snapshot policy should therefore be selective and explicit.

Recommended preserved fields include:

the provider-specific request identifier,
decision-related headers or variables,
score or anomaly fields used by the mapping,
rule identifiers when available.

The snapshot should be immutable once captured.

## Failure Modes

The adapter layer must define failure behavior clearly.

If the adapter cannot parse the upstream signal source, it should produce no threat mapping.

If the adapter encounters malformed provider data, it should produce no threat mapping and optionally emit an internal adapter error metric.

If a provider changes semantics in a backward-incompatible way, the adapter version must be bumped and the mapping rules updated explicitly.

If multiple providers provide conflicting signals, the deployment must choose a documented precedence policy rather than relying on accidental ordering.

A failure to map a threat is acceptable. A false mapping caused by ambiguous input is worse because it corrupts forensic meaning.

## Evidence Integration

When a mapped external threat exists, evidence generation should include:

the normalized threat claim,
the adapter source provider,
the adapter version,
the selected raw signal snapshot,
the upstream request identifier when available.

This becomes important later for post-mortem workflows. For example, it should be possible to connect a Tracehound evidence object back to a Cloudflare ray ID, ModSecurity rule hit, or reverse proxy correlation identifier.

This RFC does not define the full post-mortem schema, but it requires that adapter metadata be preserved in a way that future forensic and threat-intelligence modules can consume.

## Deployment Modes

This adapter model supports three deployment modes cleanly.

The first is baseline mode. No external adapter is configured. Native guardrails still operate, but no external threat mapping occurs.

The second is integrated mode. One or more upstream security systems are configured, and explicit threat verdicts are normalized into Tracehound.

The third is mixed mode. Native guardrails coexist with external signal ingestion. This is already close to the current practical behavior and should remain valid.

## Example Adapter Interface

A minimal implementation shape could look like this:

```ts
type ExternalSignalAdapter = {
  provider: string
  kind: 'waf' | 'proxy' | 'detector'
  version: string
  map(input: {
    headers: Record<string, string | string[] | undefined>
    method: string
    path: string
    requestId?: string
  }): {
    threat?: unknown
    metadata?: Record<string, unknown>
  }
}
```

This remains implementation-level and should be adapted to Tracehound’s actual package conventions, but the concept is sufficient: an adapter takes request-scoped upstream data and returns a mapped threat plus preserved metadata.

## Reference Integration with Express

The current Express package already exposes `extractScent`, which makes it the natural integration point.

The intended model is:

the middleware captures request context and raw body,
an external adapter runs inside user-provided `extractScent` or a helper around it,
if a provider verdict is recognized, the adapter returns a threat object,
the returned threat is attached to the scent,
core proceeds unchanged.

This means the first implementation step does not require redesigning the middleware architecture. A package-level adapter helper is enough.

## Initial Vendor Targets

The first wave should prioritize sources with simple and stable request-level metadata.

Cloudflare or similar edge security providers are a reasonable first candidate because they typically expose durable request correlation identifiers and signal-friendly metadata.

A second wave can target reverse proxy and self-managed WAF systems such as ModSecurity and NGINX App Protect.

A third wave can cover non-WAF detectors, which is important for future-proofing the model.

The goal is not to support every vendor immediately. The goal is to define the contract once and prove it against one or two real integrations.

## Testing Requirements

Adapter tests must cover:

deterministic mapping from representative upstream input to normalized threat output,
non-mapping on incomplete or ambiguous inputs,
snapshot preservation of relevant source fields,
versioned behavior when provider semantics change,
collision and precedence scenarios when multiple signal sources are present.

Fixtures should be vendor-specific. Generic fake inputs are not enough because provider semantics differ materially.

## Security Considerations

The primary security risk in this design is false authority through spoofed
upstream metadata.

For that reason, adapters MUST comply with the trust-boundary requirements
defined in this RFC before treating upstream metadata as authoritative.

In particular, an adapter is non-compliant if it accepts threat-mapping headers
from requests that can reach origin directly, from requests whose relevant
headers were not stripped and re-injected by a trusted upstream layer, or from
deployments that do not explicitly define trusted provider identity.

A secondary risk is excessive metadata preservation. Adapter raw snapshots
SHOULD remain selective and MUST include only the fields necessary to explain
the mapping and preserve forensic provenance.

## Compatibility

This RFC is intentionally backward-compatible with the current architectural model.

Core behavior does not change.

Framework adapters do not need fundamental redesign.

Existing deployments that manually set `scent.threat` can continue doing so.

The new adapter layer formalizes and standardizes what is already possible informally.

## Alternatives Considered

One alternative is to expand core so that it can derive its own threat decisions from request characteristics. This was rejected because it shifts Tracehound toward detection, which weakens the forensic positioning and increases product ambiguity.

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

There are still a few design decisions to settle.

The exact minimal shape of `scent.threat` should remain aligned with current core expectations and not be overdesigned.

The exact storage location for rich adapter metadata in evidence records should be chosen carefully so it remains stable for future post-mortem and threat intelligence modules.

Multi-provider precedence should be explicit. The contract should not silently merge conflicting threat authorities.

Score semantics should remain provider-specific. A forced global score model would be misleading.

## Conclusion

Tracehound should not expand its core into a detector.

The correct architectural move is to formalize an adapter layer for explicit
external threat signals. This preserves the current philosophy, strengthens
provenance, improves forensic quality, and creates a stable integration surface
for WAFs and other upstream security systems.

That keeps the product on the forensic path while making its dependency on
upstream threat authorities explicit, structured, and operationally usable.

An adapter is compliant only if every non-empty threat mapping it emits is a
valid `ScentThreat` object and only if it enforces the trust-boundary
requirements in this RFC.
