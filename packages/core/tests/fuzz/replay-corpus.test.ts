import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createMessageParser } from '../../src/core/hound-ipc.js'
import { generateSignature } from '../../src/types/signature.js'
import { encodePayload } from '../../src/utils/encode.js'
import { createTestRuntime } from './helpers.js'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const CORPUS_ROOT = resolve(TEST_DIR, '../../../../security/corpus')
const CORPUS_MANIFEST = resolve(CORPUS_ROOT, 'manifest.json')
const CORPUS_AVAILABLE = existsSync(CORPUS_MANIFEST)

interface CorpusManifest {
  seeds: Array<{ file: string }>
}

function readJson<T>(relativePath: string): T {
  const p = resolve(CORPUS_ROOT, relativePath)
  return JSON.parse(readFileSync(p, 'utf8')) as T
}

// Corpus lives in the separate tracehound/security-harness repo.
// Skip these tests when corpus is not locally available.
describe.skipIf(!CORPUS_AVAILABLE)('Corpus Replay Regression', () => {
  it('replays all curated adversarial seeds deterministically', () => {
    const manifest = readJson<CorpusManifest>('manifest.json')

    for (const seed of manifest.seeds) {
      const entry = readJson<any>(seed.file)

      if (entry.type === 'agent') {
        const runtime = createTestRuntime(entry.maxPayloadSize ?? 256)
        const before = runtime.quarantine.stats
        const result = runtime.agent.intercept(entry.scent)
        const after = runtime.quarantine.stats

        expect(result.status).toBe(entry.expect.status)
        if (typeof entry.expect.quarantineCountDelta === 'number') {
          expect(after.count - before.count).toBe(entry.expect.quarantineCountDelta)
        }
      }

      if (entry.type === 'ipc') {
        const parser = createMessageParser()
        const chunk = Buffer.from(entry.chunkHex, 'hex')

        if (entry.expect.throws) {
          expect(() => parser.feed(chunk)).toThrow()
          expect(parser.bufferedBytes).toBe(entry.expect.bufferedBytesAfterThrow)
        } else {
          const parsed = parser.feed(chunk)
          expect(parsed.length).toBe(entry.expect.messages)
        }
      }

      if (entry.type === 'duplicate') {
        const runtime = createTestRuntime(entry.maxPayloadSize ?? 2048)
        const first = runtime.agent.intercept({
          ...entry.scent,
          id: `${seed.file}:a`,
          timestamp: 1,
        })
        const second = runtime.agent.intercept({
          ...entry.scent,
          id: `${seed.file}:b`,
          timestamp: 2,
        })

        expect(first.status).toBe(entry.expect.first)
        expect(second.status).toBe(entry.expect.second)
        expect(runtime.quarantine.stats.count).toBe(entry.expect.quarantineCount)
      }

      if (entry.type === 'signature-pair') {
        const leftSig = generateSignature({
          category: entry.category,
          severity: entry.severity,
          scent: {
            id: 'left',
            source: { ip: 'corpus' },
            timestamp: 1,
            payload: entry.left.payload,
          },
        })

        const rightSig = generateSignature({
          category: entry.category,
          severity: entry.severity,
          scent: {
            id: 'right',
            source: { ip: 'corpus' },
            timestamp: 2,
            payload: entry.right.payload,
          },
        })

        expect(leftSig === rightSig).toBe(entry.expectEqual)
      }

      if (entry.type === 'state-machine-permutation') {
        const runtimeA = createTestRuntime(entry.maxPayloadSize ?? 2048)
        const runtimeB = createTestRuntime(entry.maxPayloadSize ?? 2048)

        for (let idx = 0; idx < entry.payloads.length; idx++) {
          runtimeA.agent.intercept({
            id: `perm-a-${idx}`,
            source: { ip: 'corpus' },
            timestamp: idx + 1,
            payload: entry.payloads[idx],
            threat: { category: 'injection', severity: 'high' },
          })
        }

        for (let idx = entry.payloads.length - 1; idx >= 0; idx--) {
          runtimeB.agent.intercept({
            id: `perm-b-${idx}`,
            source: { ip: 'corpus' },
            timestamp: idx + 1,
            payload: entry.payloads[idx],
            threat: { category: 'injection', severity: 'high' },
          })
        }

        expect(runtimeA.quarantine.stats.count === runtimeB.quarantine.stats.count).toBe(
          entry.expect.sameConvergedCount,
        )
      }

      if (entry.type === 'state-machine-partial-failure') {
        const runtime = createTestRuntime(entry.maxPayloadSize ?? 96)

        const accepted = runtime.agent.intercept({
          id: 'partial-ok',
          source: { ip: 'corpus' },
          timestamp: 1,
          payload: entry.acceptedPayload,
          threat: { category: 'injection', severity: 'high' },
        })

        const beforeReject = runtime.quarantine.stats

        const rejected = runtime.agent.intercept({
          id: 'partial-reject',
          source: { ip: 'corpus' },
          timestamp: 2,
          payload: entry.rejectedPayload,
          threat: { category: 'injection', severity: 'high' },
        })

        const afterReject = runtime.quarantine.stats

        expect(accepted.status).toBe(entry.expect.accepted)
        expect(rejected.status).toBe(entry.expect.rejected)
        if (entry.expect.noStateGrowthAfterReject) {
          expect(afterReject.count).toBe(beforeReject.count)
          expect(afterReject.bytes).toBe(beforeReject.bytes)
        }
      }

      if (entry.type === 'state-machine-rollback') {
        const runtimeA = createTestRuntime(entry.maxPayloadSize ?? 512)
        const runtimeB = createTestRuntime(entry.maxPayloadSize ?? 512)

        for (const [index, event] of entry.events.entries()) {
          runtimeA.agent.intercept({
            id: `rollback-a-${index}`,
            source: { ip: 'corpus' },
            timestamp: index + 1,
            payload: event,
            threat: { category: 'unknown', severity: 'medium' },
          })
        }

        for (const [index, event] of [...entry.events].reverse().entries()) {
          runtimeB.agent.intercept({
            id: `rollback-b-${index}`,
            source: { ip: 'corpus' },
            timestamp: index + 1,
            payload: event,
            threat: { category: 'unknown', severity: 'medium' },
          })
        }

        if (entry.expect.stableCount) {
          expect(runtimeA.quarantine.stats.count).toBe(runtimeB.quarantine.stats.count)
        }
        if (entry.expect.deterministicOutcome) {
          expect(runtimeA.quarantine.stats.bytes).toBe(runtimeB.quarantine.stats.bytes)
        }
      }

      if (entry.type === 'canonical-pair') {
        const left = encodePayload(entry.left, entry.maxPayloadSize ?? 1000)
        const right = encodePayload(entry.right, entry.maxPayloadSize ?? 1000)

        expect(left.canonical === right.canonical).toBe(entry.expectCanonicalEqual)
      }

      if (entry.type === 'signature-mutation') {
        const originalSig = generateSignature({
          category: entry.category,
          severity: entry.severity,
          scent: {
            id: 'original',
            source: { ip: 'corpus' },
            timestamp: 1,
            payload: entry.original.payload,
          },
        })

        const mutatedSig = generateSignature({
          category: entry.category,
          severity: entry.severity,
          scent: {
            id: 'mutated',
            source: { ip: 'corpus' },
            timestamp: 2,
            payload: entry.mutated.payload,
          },
        })

        expect(originalSig === mutatedSig).toBe(entry.expectEqual)
      }
    }
  })
})
