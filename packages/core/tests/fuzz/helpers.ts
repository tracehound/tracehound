import { createTracehound, type ITracehound } from '../../src/core/tracehound.js'
import type { Severity } from '../../src/types/common.js'
import type { ThreatCategory } from '../../src/types/scent.js'

export const FUZZ_SEED = Number(process.env.FUZZ_SEED ?? '20260216')
export const FUZZ_NUM_RUNS = Number(process.env.FUZZ_NUM_RUNS ?? '120')

const MAX_DEPTH = 4

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
    category: THREAT_CATEGORIES[i % THREAT_CATEGORIES.length],
    severity: SEVERITIES[i % SEVERITIES.length],
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

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomInt(rand: () => number, min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min
}

function randomString(rand: () => number, maxLength = 20): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_😀日本İ'
  const len = randomInt(rand, 0, maxLength)
  let out = ''
  for (let i = 0; i < len; i++) {
    out += chars[randomInt(rand, 0, chars.length - 1)]
  }
  return out
}

export function randomJsonValue(rand: () => number, depth: number = 0): unknown {
  const pick = randomInt(rand, 0, depth >= MAX_DEPTH ? 3 : 6)
  switch (pick) {
    case 0:
      return null
    case 1:
      return rand() > 0.5
    case 2:
      return Number((rand() * 1000 - 500).toFixed(5))
    case 3:
      return randomString(rand)
    case 4: {
      const len = randomInt(rand, 0, 8)
      const arr: unknown[] = []
      for (let i = 0; i < len; i++) arr.push(randomJsonValue(rand, depth + 1))
      return arr
    }
    default: {
      const obj: Record<string, unknown> = {}
      const len = randomInt(rand, 0, 8)
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
  property: (value: unknown, index: number) => void,
  options?: {
    runs?: number
    seed?: number
    generator?: (rand: () => number, i: number) => unknown
  },
): void {
  const seed = options?.seed ?? FUZZ_SEED
  const runs = options?.runs ?? FUZZ_NUM_RUNS
  const generator = options?.generator ?? ((rand: () => number) => randomJsonValue(rand))
  const rand = mulberry32(seed)

  for (let i = 0; i < runs; i++) {
    const candidate = generator(rand, i)
    try {
      property(candidate, i)
    } catch (error: unknown) {
      let minimized = candidate
      for (const shrunk of shrinkValue(candidate)) {
        try {
          property(shrunk, i)
        } catch {
          minimized = shrunk
        }
      }
      throw new Error(
        `[fuzz:${name}] seed=${seed} run=${i} input=${JSON.stringify(minimized)} error=${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
