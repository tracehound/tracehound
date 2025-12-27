# Configuration Reference

Complete configuration options for Tracehound components.

---

## Agent Configuration

```typescript
interface AgentConfig {
  /** Maximum payload size in bytes (default: 1MB) */
  maxPayloadSize: number
}
```

### Example

```typescript
const agent = createAgent(
  { maxPayloadSize: 5_000_000 }, // 5MB
  quarantine,
  rateLimiter,
  evidenceFactory
)
```

---

## Quarantine Configuration

```typescript
interface QuarantineConfig {
  /** Maximum number of evidence entries (default: 1000) */
  maxCount: number

  /** Maximum total bytes for all evidence (default: 100MB) */
  maxBytes: number

  /** Eviction policy when limits are reached */
  evictionPolicy: 'priority' | 'lru' | 'fifo'
}
```

### Eviction Policies

| Policy     | Description                               |
| ---------- | ----------------------------------------- |
| `priority` | Evict lowest severity first (recommended) |
| `lru`      | Evict least recently accessed             |
| `fifo`     | Evict oldest first                        |

### Example

```typescript
const quarantine = createQuarantine(
  {
    maxCount: 5000,
    maxBytes: 500_000_000, // 500MB
    evictionPolicy: 'priority',
  },
  auditChain
)
```

---

## Rate Limiter Configuration

```typescript
interface RateLimiterConfig {
  /** Time window in milliseconds (default: 60000 = 1 minute) */
  windowMs: number

  /** Maximum requests per window (default: 100) */
  maxRequests: number

  /** Block duration when limit exceeded (default: 300000 = 5 minutes) */
  blockDurationMs: number
}
```

### Example

```typescript
const rateLimiter = createRateLimiter({
  windowMs: 60_000, // 1 minute window
  maxRequests: 50, // 50 requests per minute
  blockDurationMs: 600_000, // 10 minute block
})
```

---

## Hound Pool Configuration

```typescript
interface HoundPoolConfig {
  /** Number of pre-spawned hound processes (default: 4) */
  poolSize: number

  /** Timeout for hound operations in ms (default: 5000) */
  timeoutMs: number

  /** Action when pool is exhausted */
  exhaustedAction: 'drop' | 'escalate' | 'defer'

  /** Process constraints (optional) */
  constraints?: HoundProcessConstraints
}

interface HoundProcessConstraints {
  /** Maximum memory in bytes (default: 50MB) */
  maxMemory?: number

  /** Maximum CPU time in ms (default: 1000) */
  maxCpuTime?: number
}
```

### Exhausted Actions

| Action     | Description                |
| ---------- | -------------------------- |
| `drop`     | Silently drop the request  |
| `escalate` | Throw an error             |
| `defer`    | Queue for later processing |

### Example

```typescript
const pool = createHoundPool({
  poolSize: 8,
  timeoutMs: 3000,
  exhaustedAction: 'defer',
  constraints: {
    maxMemory: 100_000_000, // 100MB
    maxCpuTime: 2000, // 2 seconds
  },
})
```

---

## Trust Boundary Configuration

```typescript
interface TrustBoundaryConfig {
  detector: {
    source: 'external' | 'internal'
    trustLevel: 'trusted' | 'verify' | 'untrusted'
  }

  coldStorage: {
    trustLevel: 'trusted' | 'verify'
    verification: 'hash' | 'signature' | 'none'
  }

  cluster: {
    trustLevel: 'trusted' | 'untrusted'
  }
}
```

### Example

```typescript
const trustBoundary: TrustBoundaryConfig = {
  detector: {
    source: 'external',
    trustLevel: 'verify', // Always verify external signals
  },
  coldStorage: {
    trustLevel: 'verify',
    verification: 'hash', // SHA-256 verification
  },
  cluster: {
    trustLevel: 'untrusted', // Assume hostile network
  },
}
```

---

## Fail-Safe Configuration

```typescript
interface FailSafeConfig {
  /** Memory thresholds (0-1 ratio) */
  memory: ThresholdConfig

  /** Quarantine capacity thresholds (0-1 ratio) */
  quarantine: ThresholdConfig

  /** Error rate thresholds (errors per minute) */
  errorRate: ThresholdConfig
}

interface ThresholdConfig {
  warning: number // Trigger warning callback
  critical: number // Trigger critical callback
  emergency: number // Trigger emergency callback
}
```

### Default Values

```typescript
const DEFAULT_FAIL_SAFE_CONFIG = {
  memory: {
    warning: 0.7, // 70%
    critical: 0.85, // 85%
    emergency: 0.95, // 95%
  },
  quarantine: {
    warning: 0.7,
    critical: 0.85,
    emergency: 0.95,
  },
  errorRate: {
    warning: 10, // 10 errors/min
    critical: 50, // 50 errors/min
    emergency: 100, // 100 errors/min
  },
}
```

### Example

```typescript
import { createFailSafe } from '@tracehound/core'

const failSafe = createFailSafe({
  quarantine: {
    warning: 0.6,
    critical: 0.8,
    emergency: 0.95,
  },
})

failSafe.on('warning', (event) => {
  console.warn('Quarantine capacity warning:', event)
})

failSafe.on('emergency', (event) => {
  console.error('EMERGENCY:', event)
  // Trigger emergency flush
  quarantine.flush()
})
```

---

## Lane Queue Configuration

```typescript
interface LaneQueueConfig {
  lanes: Record<Severity, LaneConfig>
  overflow: 'drop_oldest' | 'drop_lowest' | 'reject'
}

interface LaneConfig {
  maxSize: number // Maximum alerts in lane
  rateLimit: number // Max alerts per second (0 = unlimited)
}
```

### Default Values

```typescript
const DEFAULT_LANE_CONFIG = {
  lanes: {
    critical: { maxSize: 1000, rateLimit: 0 },
    high: { maxSize: 500, rateLimit: 100 },
    medium: { maxSize: 200, rateLimit: 50 },
    low: { maxSize: 100, rateLimit: 20 },
  },
  overflow: 'drop_oldest',
}
```

---

## Environment Variables

| Variable                 | Description                          | Default   |
| ------------------------ | ------------------------------------ | --------- |
| `TRACEHOUND_MAX_PAYLOAD` | Max payload size in bytes            | `1000000` |
| `TRACEHOUND_LOG_LEVEL`   | Log level (debug, info, warn, error) | `info`    |
| `TRACEHOUND_POOL_SIZE`   | Hound pool size                      | `4`       |

---

## Complete Example

```typescript
import {
  createAgent,
  createQuarantine,
  createRateLimiter,
  createEvidenceFactory,
  createFailSafe,
  createLaneQueue,
  AuditChain,
} from '@tracehound/core'

// Core components
const auditChain = new AuditChain()

const quarantine = createQuarantine(
  {
    maxCount: 5000,
    maxBytes: 500_000_000,
    evictionPolicy: 'priority',
  },
  auditChain
)

const rateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 100,
  blockDurationMs: 300_000,
})

const evidenceFactory = createEvidenceFactory()

// Agent
const agent = createAgent({ maxPayloadSize: 5_000_000 }, quarantine, rateLimiter, evidenceFactory)

// Fail-safe
const failSafe = createFailSafe()
failSafe.on('emergency', () => quarantine.flush())

// Alert queue
const alertQueue = createLaneQueue()
alertQueue.onAlert((alert) => {
  // Send to external SIEM
})
```

---

## See Also

- [Getting Started](./GETTING-STARTED.md)
- [API Documentation](./API.md)
- [RFC-0000: Core Architecture](./rfc/0000-Proposal.md)
