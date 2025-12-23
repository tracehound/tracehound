# @tracehound/core

Security buffer system for threat quarantine.

## Installation

```bash
pnpm add @tracehound/core
```

## Status

**Phase 1:** ✅ Complete (Types + Utilities)
**Phase 2:** 🚧 In Progress (Evidence, Quarantine, Agent)

## Usage

### Signature Generation

```ts
import { generateSignature, validateSignature } from '@tracehound/core'
import type { ThreatInput } from '@tracehound/core'

const threat: ThreatInput = {
  category: 'injection',
  severity: 'high',
  scent: {
    id: 'req-123',
    payload: { query: 'DROP TABLE users' },
    source: '192.168.1.1',
    timestamp: Date.now(),
  },
}

const signature = generateSignature(threat)
// "injection:a1b2c3d4e5f6..."

validateSignature(signature) // true
```

### Configuration

```ts
import { DEFAULT_CONFIG, mergeWithDefaults } from '@tracehound/core'
import type { TracehoundConfig } from '@tracehound/core'

// Use defaults
console.log(DEFAULT_CONFIG.maxPayloadSize) // 1_000_000

// Override specific values
const config = mergeWithDefaults({
  maxPayloadSize: 500_000,
  rateLimit: { maxRequests: 50 },
})
```

### Error Handling

```ts
import { Errors, createError } from '@tracehound/core'

// Pre-defined errors
const err = Errors.payloadTooLarge(2_000_000, 1_000_000)

// Custom errors
const custom = createError('agent', 'CUSTOM_ERROR', 'Something went wrong')
```

### Type Guards

```ts
import { isQuarantined, isError, isClean } from '@tracehound/core'
import type { InterceptResult } from '@tracehound/core'

function handleResult(result: InterceptResult) {
  if (isQuarantined(result)) {
    console.log('Threat quarantined:', result.handle.signature)
  } else if (isError(result)) {
    console.error('Error:', result.error.message)
  } else if (isClean(result)) {
    console.log('Request is clean')
  }
}
```

## API Reference

### Types

- `Scent` - Input unit
- `Threat` - Classified scent with signature
- `ThreatInput` - Threat before signature generation
- `EvidenceHandle` - Quarantined evidence (Phase 2)
- `InterceptResult` - Result of intercept operation
- `TracehoundConfig` - Configuration options

### Functions

- `generateSignature(threat)` - Generate collision-resistant signature
- `validateSignature(sig)` - Validate signature format
- `serialize(value)` - Deterministic JSON serialization
- `hash(data)` - SHA-256 hash
- `generateSecureId()` - UUIDv7 + random suffix

## License

MIT
