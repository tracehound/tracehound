# RFC-0004: ResponseEngine — External Policy-Driven Response

## Metadata

| Field            | Value                               |
| ---------------- | ----------------------------------- |
| Status           | Placeholder (v2.0.0 scope)          |
| Security Impact  | High (active response capability)   |
| Operational Risk | Medium (external policy dependency) |
| Dependencies     | RFC-0000 (Core)                     |
| Author           | -                                   |
| Created          | 2024-12-27                          |

---

## Motivation

Tracehound is currently a **passive buffer**. It quarantines threats but does not stop attackers. Security review identified this as a critical gap for enterprise adoption:

> "Attacker SQL injection deniyor, WAF detect ediyor, Tracehound quarantine ediyor.
> Attacker 10 farklı payload deniyor. Her biri ayrı quarantine entry.
> **Ama attacker hala bağlı, denemeye devam ediyor.**"

This RFC introduces an **optional** response capability that remains **decision-free**.

---

## Core Principle: External Policy Control

**ResponseEngine does NOT make decisions.**

```
ThreatLedger statistics
        │
        ▼
External Policy Engine (customer-controlled)
        │
        │ "Block this source for 5 minutes"
        ▼
ResponseEngine (executes action)
```

Tracehound core remains decision-free. Policies are:

- Defined externally
- Evaluated by external policy engine
- Executed by ResponseEngine

---

## Proposed Types

```ts
interface ResponseAction {
  type: 'block_source' | 'throttle' | 'challenge' | 'alert'
  duration: number // seconds
  scope: 'ip' | 'user' | 'session'
  reason: string
}

interface ResponseEngine {
  /** Execute action from external policy */
  execute(action: ResponseAction): void

  /** Query active responses */
  getActive(): ResponseAction[]

  /** Revoke response early */
  revoke(actionId: string): void
}

interface ResponseEngineConfig {
  /** Maximum concurrent active responses */
  maxActive: number

  /** Action executors */
  executors: {
    block_source?: BlockSourceExecutor
    throttle?: ThrottleExecutor
    challenge?: ChallengeExecutor
    alert?: AlertExecutor
  }
}
```

---

## Integration Pattern

```ts
// External policy engine (customer-controlled)
const policyEngine = createPolicyEngine({
  rules: [
    {
      condition: 'threat_count > 5 AND timeframe < 60s',
      action: { type: 'block_source', duration: 300, scope: 'ip' },
    },
  ],
})

// Tracehound with ResponseEngine addon
const tracehound = createTracehound({
  responseEngine: createResponseEngine({
    executors: {
      block_source: expressBlocker,
    },
  }),
})

// Policy evaluation loop (external)
setInterval(() => {
  const stats = tracehound.threatLedger.getStats()
  const actions = policyEngine.evaluate(stats)

  for (const action of actions) {
    tracehound.responseEngine.execute(action)
  }
}, 1000)
```

---

## Scope

### In Scope

- Source blocking (IP, user, session)
- Rate limiting escalation (aggressive throttle)
- Challenge injection (CAPTCHA, MFA prompt)
- Alert emission (PagerDuty, Slack, webhook)

### Out of Scope

- Policy definition (external)
- Decision making (external)
- WAF rule injection (separate addon)
- Network-level blocking (infrastructure layer)

---

## Security Considerations

| Concern           | Mitigation                            |
| ----------------- | ------------------------------------- |
| Policy abuse      | External policy engine responsibility |
| Action escalation | maxActive limit, duration caps        |
| Revocation delay  | Immediate revoke API                  |
| Logging           | All actions audit-logged              |

---

**Status: PLACEHOLDER**

Full specification will be written during Phase 7 planning.
