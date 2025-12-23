# @tracehound/core

Security buffer system for threat quarantine.
Part of the Tracehound Cyberimmune System.

## Status

**Phase 1-4 Complete:** ✅

- **Phase 1:** Foundation (Types, Utils)
- **Phase 2:** Evidence, Quarantine, AuditChain
- **Phase 3:** Agent, RateLimiter
- **Phase 4:** HoundPool, Scheduler, Watcher, BinaryCodec

## Installation

```bash
pnpm add @tracehound/core
```

## Core Components

### 1. Agent (`IAgent`)

The main entry point. Orchestrates the threat detection flow.

- **Stateless:** Depends on injected services.
- **Fail-safe:** Defaults to "clean" on error.

```ts
import {
  createAgent,
  createQuarantine,
  createRateLimiter,
  createEvidenceFactory,
} from '@tracehound/core'

const agent = createAgent({ maxPayloadSize: 1_000_000 })
const result = agent.intercept(scent)
```

### 2. Hound Pool (`IHoundPool`)

Isolated worker pool for evidence processing.

- **Strict Sandbox:** No eval, no network, no storage.
- **Fire-and-Forget:** Agent never awaits detection.
- **Resilient:** Auto-replenish on crash/timeout.

```ts
// Activate analysis (returns immediately)
houndPool.activate(evidence)
```

### 3. Watcher (`IWatcher`)

Pull-based observability.

- **Passive:** Does not emit events (no EventEmitter).
- **Snapshot:** Provides immutable view of system state.

```ts
const snapshot = watcher.snapshot()
console.log(`Threats: ${snapshot.threats.total}`)
```

### 4. Scheduler (`IScheduler`)

Background task management.

- **Jittered:** Prevents timing attacks.
- **Load-Aware:** Skips ticks if system is busy (`skipIfBusy`).

## Usage Example

```ts
import {
  createAgent,
  createQuarantine,
  createRateLimiter,
  createEvidenceFactory,
  createHoundPool,
  AuditChain,
} from '@tracehound/core'

// 1. Setup Dependencies
const auditChain = new AuditChain()
const quarantine = createQuarantine({ maxCount: 1000 }, auditChain)
const rateLimiter = createRateLimiter({ windowMs: 60000, maxRequests: 100 })
const factory = createEvidenceFactory()

// 2. Create Agent
const agent = createAgent({ maxPayloadSize: 1_000_000 }, quarantine, rateLimiter, factory)

// 3. Intercept Traffic
const result = agent.intercept({
  id: 'req-1',
  source: '192.168.1.1',
  payload: { user: 'input' },
  timestamp: Date.now(),
})

if (result.status === 'quarantined') {
  console.log('Threat quarantined:', result.handle.signature)
}
```

## Architecture

```
[Traffic] → (Agent) → [RateLimiter]
               │
               ▼
[EvidenceFactory] → (Hash/Compress) → [Evidence]
                                         │
                                         ▼
                                   [Quarantine]
                                         │
                                         ▼
                                    (HoundPool) → [Analysis]
```

## License

MIT
