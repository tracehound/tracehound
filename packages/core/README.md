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
import { createTracehound } from '@tracehound/core'

const th = createTracehound({ maxPayloadSize: 1_000_000 })
const result = th.agent.intercept(scent)
```

### 2. Hound Pool (`IHoundPool`)

Process-separated child worker pool for evidence processing.

- **Containment-Oriented:** Uses process separation and hardening flags; OS sandboxing depends on deployment policy.
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
import { createTracehound } from '@tracehound/core'

// 1. Create Tracehound Instance
const th = createTracehound({
  maxPayloadSize: 1_000_000,
  quarantine: { maxCount: 1000 },
  rateLimit: { windowMs: 60000, maxRequests: 100 },
  houndPool: { poolSize: 4 }, // Automatically provisions process-separated workers
})

// 2. Intercept Traffic
const result = th.agent.intercept({
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

Open-Core — this package is the open-source substrate of the Tracehound ecosystem.
