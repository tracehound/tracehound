# Pricing

## Tracehound Core

**Deterministic Runtime Component**

**$299 / month**

Tracehound Core is licensed as a **runtime component**, not as a service.

It provides a deterministic, decision-free security buffer that operates inside your application boundary. Configuration is flexible, but **behavior is not contractually frozen**.

**What is guaranteed**

* Deterministic execution under normal and degraded conditions
* Explicit memory ownership and bounded degradation
* Configurable quarantine and cold storage primitives
* Fire-and-forget evidence persistence (write-only, no read-back)

**What is intentionally not guaranteed**

* Backward compatibility across minor versions
* Stable event contracts
* Adapter behavior consistency

**Failure behavior**

* System prioritizes **liveness over completeness**
* Degradation may reduce observability, never application availability
* No failure propagates into the request lifecycle

**Who this is for**

* Teams embedding Tracehound as an internal security primitive
* Environments where operators explicitly **own upgrade and behavior risk**

> You get the engine. You own the operational envelope.

---

## Tracehound Production

**Operational Stability Contract**

**$799 / month**

Tracehound Production upgrades the core runtime into a **predictable subsystem** suitable for live SaaS environments.

Here, behavior is no longer best-effort. It is **documented, versioned, and stable**.

**What is guaranteed**

* Backward-compatible contracts for:

  * Event taxonomy
  * Notification semantics
  * Official cold storage adapters
* Defined failure behavior under memory pressure and pool exhaustion
* Upgrade-safe releases with no silent semantic changes

**Failure behavior**

* Degradation is explicit and bounded
* Adapter failures degrade safely, never silently
* Runtime behavior remains consistent across patch upgrades

**Who this is for**

* Production SaaS systems
* Teams that require **operational predictability** rather than raw flexibility

> You are no longer testing how the system behaves. You are relying on it.

---

## Tracehound Enterprise

**Compliance & Forensics Substrate**

**Starting at $1,500 / month**
*(final pricing depends on support level and retention guarantees)*

Tracehound Enterprise treats the runtime as **evidence-bearing infrastructure**.

This tier exists for environments where security incidents are not just technical events, but **auditable facts**.

**What is guaranteed**

* Deterministic snapshot export for offline verification
* Stable evidence descriptors suitable for audits and legal review
* RFC-level guarantees on data shape and behavior
* Long-term support branches with frozen semantics

**Failure behavior**

* Evidence integrity is preserved even under forced degradation
* All degradation paths are explainable and reviewable
* Operational behavior is traceable across versions

**Who this is for**

* Regulated environments (fintech, payments, healthcare)
* Teams accountable to auditors, regulators, and legal review

> This is not observability. This is record-keeping under pressure.

---

## Argos (Separate Product)

**Behavioral Signal Runtime**

**$750 / month**
*(licensed separately, independent contract)*

Argos is licensed and operated **independently** from Tracehound.

It extends the observable surface of the runtime by producing **non-authoritative behavioral signals**.

**What Argos provides**

* Sampling-based runtime and event-loop signals
* No decisions, no blocking, no enforcement
* Signals intended for external correlation and verification

**What Argos does not guarantee**

* Determinism
* Completeness
* Detection accuracy

**Operational implication**

* Introduces a new trust boundary
* Requires explicit risk acceptance
* Covered by a separate SLA and legal disclaimer

> Argos does not make your system safer by default.
> It makes previously invisible behavior observable.

---

# Why This Costs Money

Tracehound is not priced on traffic, usage, or attack volume — because **none of those are the problem it solves**.

You are not paying for:

* Requests processed
* Threats detected
* Data stored

You are paying for **behavioral guarantees under failure**.

---

## 1. Determinism is expensive

Most security tools tolerate nondeterminism:

* Garbage-collected memory
* Retry storms
* Best-effort async pipelines

Tracehound does not.

Maintaining deterministic behavior under memory pressure, pool exhaustion, and partial failure requires:

* Explicit ownership models
* Bounded degradation paths
* Strictly constrained concurrency

This engineering effort does not scale with usage.
It scales with **correctness guarantees**.

---

## 2. Failure semantics are designed, not assumed

In Tracehound, every failure mode is intentional:

* What degrades
* What never degrades
* What is preserved at all costs

Designing and maintaining these semantics — without blocking the host application — is the core value of the system.

This is not feature work.
This is **failure engineering**.

---

## 3. Compliance requires frozen behavior

Enterprise pricing exists because:

* Data shapes must remain stable
* Evidence must remain verifiable
* Behavior must remain explainable months or years later

That requires versioned contracts and long-term support.
Those guarantees have real cost.

---

## 4. You are paying for risk ownership transfer

* **Core**: you own the risk
* **Production**: risk is shared
* **Enterprise**: risk is contractually bounded

The price difference reflects **who is accountable when things go wrong**.

---

## Final line (keep this)

> If your system can tolerate undefined behavior during security incidents,
> you do not need Tracehound.
>
> If it cannot, this is what precision costs.
