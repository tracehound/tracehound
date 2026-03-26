import { createHmac } from 'node:crypto'
import { createTracehound, type ITracehound } from '../../src/core/tracehound.js'
import type { Severity } from '../../src/types/common.js'
import type { JsonSerializable } from '../../src/types/common.js'
import type { ThreatCategory } from '../../src/types/scent.js'

function parseDeterministicEnvInt(
  name: string,
  fallback: number,
  options?: { min?: number; max?: number },
): number {
  const raw = process.env[name]

  if (raw === undefined) {
    return fallback
  }

  const normalized = raw.trim()
  if (!/^-?\d+$/.test(normalized)) {
    throw new Error(`${name} must be a base-10 integer, received ${JSON.stringify(raw)}`)
  }

  const value = Number(normalized)
  const min = options?.min ?? Number.MIN_SAFE_INTEGER
  const max = options?.max ?? Number.MAX_SAFE_INTEGER

  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a safe integer between ${min} and ${max}, received ${raw}`)
  }

  return value
}

export const FUZZ_SEED = parseDeterministicEnvInt('FUZZ_SEED', 20260216, { min: 0 })
export const FUZZ_NUM_RUNS = parseDeterministicEnvInt('FUZZ_NUM_RUNS', 120, {
  min: 1,
  max: 10_000,
})

const MAX_DEPTH = 4
const FLOAT_SCALE = 100_000

interface DeterministicCryptoRandom {
  nextBool(): boolean
  nextInt(min: number, max: number): number
  nextScaledNumber(min: number, max: number, scale: number): number
}

export const THREAT_CATEGORIES: ThreatCategory[] = [
  'injection',
  'ddos',
  'flood',
  'spam',
  'malware',
  'unknown',
]

export const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical']

export function buildThreat(i: number) {
  return {
    category: THREAT_CATEGORIES[i % THREAT_CATEGORIES.length]!,
    severity: SEVERITIES[i % SEVERITIES.length]!,
  } as const
}

export function createTestRuntime(maxPayloadSize: number = 256): ITracehound {
  return createTracehound({
    maxPayloadSize,
    rateLimit: {
      windowMs: 60_000,
      maxRequests: 100_000,
      blockDurationMs: 1,
    },
    quarantine: {
      maxCount: 100_000,
      maxBytes: 100_000_000,
    },
  })
}

function createDeterministicCryptoRandom(seed: number): DeterministicCryptoRandom {
  const key = Buffer.from(`tracehound-fuzz-seed:${seed}`, 'utf8')
  let counter = 0n
  let pool = Buffer.alloc(0)
  let offset = 0

  function refillPool(): void {
    const message = Buffer.alloc(8)
    message.writeBigUInt64BE(counter, 0)
    counter += 1n

    pool = createHmac('sha256', key).update(message).digest()
    offset = 0
  }

  function nextByte(): number {
    if (offset >= pool.length) {
      refillPool()
    }

    const value = pool[offset]!
    offset += 1
    return value
  }

  function nextUInt32(): number {
    const bytes = Buffer.from([nextByte(), nextByte(), nextByte(), nextByte()])
    return bytes.readUInt32BE(0)
  }

  function nextInt(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new Error(`invalid deterministic fuzz integer range: min=${min} max=${max}`)
    }

    const span = max - min + 1
    if (span > 0x100000000) {
      throw new Error(`deterministic fuzz integer range too large: span=${span} exceeds 2^32`)
    }
    const limit = 0x100000000 - (0x100000000 % span)
    let value = nextUInt32()

    while (value >= limit) {
      value = nextUInt32()
    }

    return min + (value % span)
  }

  return {
    nextBool(): boolean {
      return (nextByte() & 1) === 1
    },
    nextInt,
    nextScaledNumber(min: number, max: number, scale: number): number {
      return nextInt(min * scale, max * scale) / scale
    },
  }
}

function randomString(rand: DeterministicCryptoRandom, maxLength = 20): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_😀日本İ'
  const len = rand.nextInt(0, maxLength)
  let out = ''
  for (let i = 0; i < len; i++) {
    out += chars[rand.nextInt(0, chars.length - 1)]
  }
  return out
}

export function randomJsonValue(rand: DeterministicCryptoRandom, depth: number = 0): unknown {
  const pick = rand.nextInt(0, depth >= MAX_DEPTH ? 3 : 6)
  switch (pick) {
    case 0:
      return null
    case 1:
      return rand.nextBool()
    case 2:
      return rand.nextScaledNumber(-500, 500, FLOAT_SCALE)
    case 3:
      return randomString(rand)
    case 4: {
      const len = rand.nextInt(0, 8)
      const arr: unknown[] = []
      for (let i = 0; i < len; i++) arr.push(randomJsonValue(rand, depth + 1))
      return arr
    }
    default: {
      const obj: Record<string, unknown> = {}
      const len = rand.nextInt(0, 8)
      for (let i = 0; i < len; i++)
        obj[`k${i}_${randomString(rand, 6)}`] = randomJsonValue(rand, depth + 1)
      return obj
    }
  }
}

function shrinkValue(value: unknown): unknown[] {
  if (typeof value === 'string') {
    return [value.slice(0, Math.floor(value.length / 2)), '']
  }

  if (typeof value === 'number') {
    return [Math.trunc(value / 2), 0]
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return []
    return [value.slice(0, Math.floor(value.length / 2)), []]
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) return []
    return [Object.fromEntries(entries.slice(0, Math.floor(entries.length / 2))), {}]
  }

  return []
}

export function runDeterministicProperty(
  name: string,
  property: (value: JsonSerializable, index: number) => void,
  options?: {
    runs?: number
    seed?: number
    generator?: (rand: DeterministicCryptoRandom, i: number) => JsonSerializable
  },
): void {
  const seed = options?.seed ?? FUZZ_SEED
  const runs = options?.runs ?? FUZZ_NUM_RUNS
  const generator =
    options?.generator ??
    ((rand: DeterministicCryptoRandom) => randomJsonValue(rand) as JsonSerializable)
  const rand = createDeterministicCryptoRandom(seed)

  for (let i = 0; i < runs; i++) {
    const candidate = generator(rand, i)
    try {
      property(candidate, i)
    } catch (error: unknown) {
      let minimized: JsonSerializable = candidate
      for (const shrunk of shrinkValue(candidate)) {
        try {
          property(shrunk as JsonSerializable, i)
        } catch {
          minimized = shrunk as JsonSerializable
        }
      }
      throw new Error(
        `[fuzz:${name}] seed=${seed} run=${i} input=${JSON.stringify(minimized)} error=${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
