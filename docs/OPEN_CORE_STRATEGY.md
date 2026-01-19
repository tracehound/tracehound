# Tracehound Open‑Core Strategy

## 0. Purpose of This Document

This document exists to **end the licensing / distribution debate** and to give the entire team a _single, durable rationale_ for why Tracehound adopts an **open‑core + paid satellites** model.

It is not a pitch deck.
It is not marketing copy.
It is an **engineering, security, and product alignment document**.

If this document is accepted, the following questions are considered _closed_ unless fundamentals change:

- Should we hard‑enforce licenses in runtime?
- Should core security behavior depend on payment state?
- Should Tracehound pivot to DRM‑style binary enforcement?

Answer: **No. And here is why.**

---

## 1. Tracehound Is a Security Substrate, Not a Feature Product

### 1.1 What Tracehound Actually Is

Tracehound is:

- a **deterministic security buffer**
- a **runtime evidence custody layer**
- a **failure‑predictable containment substrate**

Tracehound is _not_:

- a detection engine
- a policy engine
- a heuristic system
- an AI system

This distinction matters because **substrates obey different trust rules than products**.

A substrate must remain trustworthy **even when everything around it fails** — including billing, licensing, networking, and vendor infrastructure.

---

## 2. Why License‑Driven Runtime Enforcement Is Incompatible with Security

### 2.1 License State Must Never Be a Security Authority

Any design where:

> _license invalid → security behavior changes_

creates an unacceptable attack surface.

If an attacker can influence license state (clock skew, file corruption, config tampering, build alteration), they can:

- reduce visibility
- disable interception
- corrupt evidence

This transforms licensing into a **privileged security control plane**, which is categorically unsafe.

### 2.2 Kill‑Switches Are Anti‑Security

A security component that can:

- refuse to initialize
- disable interception
- shut itself down

based on _commercial state_ is indistinguishable from a self‑inflicted denial‑of‑service.

**Security software must degrade safely, not disappear.**

---

## 3. Why Closed Binary / DRM Models Were Rejected

### 3.1 Binary ≠ Trust

In security tooling, closed binaries do not increase trust. They increase **vendor dependency**.

Security teams routinely ask:

- Can we audit the code path that produced this evidence?
- Can we reason about failure modes?
- Can we replay incidents deterministically?

Opaque binaries weaken all three.

### 3.2 Determinism Requires Inspectability

Tracehound’s strongest differentiator is **determinism**.

Determinism is only credible when:

- logic is inspectable
- invariants are visible
- failure semantics are documented

A DRM‑locked binary undermines this claim.

---

## 4. The Open‑Core Decision

### 4.1 What Is Open

The following packages are open‑source and form the **security substrate**:

- `@tracehound/core`
- `@tracehound/express`
- `@tracehound/fastify`
- `@tracehound/cli`

These packages:

- define security invariants
- handle interception and quarantine
- produce evidence
- must remain operational regardless of payment

### 4.2 Why This Must Be Open

Because Tracehound claims to be:

- trustworthy
- deterministic
- auditable

Open‑source is not ideology here; it is **structural necessity**.

---

## 5. Paid Satellites: Where Monetization Actually Belongs

### 5.1 Principle: Monetize Capability, Not Safety

Paid modules extend **operational capability**, not **security visibility**.

They may be absent without making the system unsafe.

### 5.2 Paid Modules ($49)

- `@tracehound/argos` — runtime behavioral observation
- `@tracehound/talos` — external policy execution
- `@tracehound/huginn` — threat intelligence ingestion
- `@tracehound/muninn` — historical ledger & aggregation

These modules:

- enrich
- correlate
- orchestrate

They do **not** own evidence or interception.

### 5.3 Advanced Modules ($99)

- `@tracehound/norns` — deterministic readiness synthesis
- `@tracehound/furies` — adversarial validation & stress harness

These modules:

- are enterprise‑grade
- are optional
- are powerful but non‑authoritative

---

## 6. Flat Pricing and the Rejection of Tiered Enforcement

### 6.1 Why No Per‑Seat, No Usage, No Tiers

Security does not scale linearly with users.

Per‑seat pricing:

- creates procurement friction
- encourages under‑deployment
- penalizes correct security posture

Flat pricing communicates:

> _This is infrastructure, not SaaS trivia._

### 6.2 Why We Avoid Runtime License Enforcement

We explicitly reject:

- feature gates inside core security paths
- license checks in hot paths
- expiration‑driven behavior changes

Payment affects **what you can add**, not **what you can see**.

---

## 7. Watchtower: Where Commercial Gravity Lives

### 7.1 Watchtower Is Not Security — It Is Leverage

`@tracehound/watchtower` is:

- a forensic cockpit
- an operational visualization layer
- a workflow accelerator

It does not create evidence.
It does not make security decisions.

It makes **humans effective**.

This is where strong commercial value legitimately exists.

---

## 8. Why This Model Is Harder — and Why We Accept That

Yes, this model:

- creates more packages
- requires clearer boundaries
- forces architectural discipline

But it also:

- eliminates license‑security coupling
- avoids DRM arms races
- aligns with how serious security teams think

We choose **hard engineering over easy monetization**.

---

## 9. What This Decision Locks In

Once adopted, the following are considered invariants:

- Core security behavior is never disabled by licensing
- Evidence custody is never monetized
- Open core remains inspectable
- Paid modules never become security authorities

Any future proposal must respect these.

---

## 10. Licensing & Maintenance Policy (Final)

Tracehound does **not** use lifetime licenses and does **not** use classic SaaS-style subscriptions for core packages.

The adopted model is **perpetual use with time-bounded update entitlement**.

When a package is purchased, the customer receives a **perpetual right to use the acquired version**. The software does not stop working if payment ends. There are no runtime kill-switches, no feature shutdowns, and no security behavior changes tied to license state.

Updates, security fixes, and official support are provided for a **fixed time window (default: 12 months)** from the date of purchase. After this window expires, the customer may continue using the existing version indefinitely but loses access to new releases and fixes.

This policy is intentional:

- Security software requires continuous maintenance to remain correct.
- Lifetime licenses create unbounded security and support liabilities.
- License state must never become a security authority.

### Scope

This policy applies to:

- All paid Tracehound satellite packages (`argos`, `talos`, `huginn`, `muninn`, `norns`, `furies`)

The open-source core packages remain fully usable regardless of commercial status.

### Watchtower Exception

`@tracehound/watchtower` is licensed as a **time-based subscription**.

Watchtower is an operational interface and workflow accelerator, not a security substrate. Its value derives from continuous evolution, schema alignment, and UX iteration. A subscription model is therefore appropriate and does not impact core security guarantees.

### Invariant

At no point does licensing:

- disable interception
- reduce security visibility
- alter evidence custody
- introduce runtime failure modes

Licensing affects **access to updates and tooling**, never **security correctness**.

---

## 11. Final Statement

Tracehound is not protected by secrecy.
It is protected by **correctness, clarity, and restraint**.

We do not sell locks.
We sell **reliable ground to stand on**.

This document exists so the team can move forward without revisiting this debate again.
