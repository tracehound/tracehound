/**
 * Cold Storage Pipeline Scenario
 *
 * End-to-end test of the evidence lifecycle through cold storage:
 *
 *   Scent → Agent → Quarantine → Evidence
 *     → Async Encode → S3 Write → S3 Read → Verify → Async Decode
 *       → Assert original data intact
 *
 * Tests realistic production flows:
 * 1. Single evidence full pipeline
 * 2. Batch evacuation (100 evidence items → cold storage)
 * 3. Concurrent read/write under contention
 * 4. Storage failure mid-batch (partial evacuation recovery)
 * 5. Integrity chain: envelope → verify → decode → original
 * 6. Async codec throughout (never blocks event loop)
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  Agent,
  AuditChain,
  createAgent,
  createEvidenceFactory,
  createRateLimiter,
  generateSecureId,
  Quarantine,
  type Scent,
} from '../src/index.js'
import {
  decodeWithIntegrityAsync,
  encodeWithIntegrityAsync,
  verify,
} from '../src/utils/binary-codec.js'
import type { S3LikeClient } from '../src/core/s3-cold-storage.js'
import { S3ColdStorage } from '../src/core/s3-cold-storage.js'

// ──────────────────────────────────────────────────────────────────────────────
// Realistic Mock S3 Client
// Simulates latency, occasional failures, and concurrent access
// ──────────────────────────────────────────────────────────────────────────────

interface MockS3Options {
  /** Simulated write latency in ms */
  writeLatencyMs?: number
  /** Simulated read latency in ms */
  readLatencyMs?: number
  /** Probability of write failure (0-1) */
  writeFailRate?: number
  /** Fail after this many writes */
  failAfterWrites?: number
}

function createRealisticMockS3(opts: MockS3Options = {}): S3LikeClient & {
  objects: Map<string, Uint8Array>
  writeCount: number
  readCount: number
} {
  const objects = new Map<string, Uint8Array>()
  let writeCount = 0
  let readCount = 0

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  return {
    get objects() { return objects },
    get writeCount() { return writeCount },
    get readCount() { return readCount },

    async putObject(params) {
      writeCount++

      if (opts.failAfterWrites !== undefined && writeCount > opts.failAfterWrites) {
        throw new Error('S3 ServiceUnavailable: write limit exceeded')
      }

      if (opts.writeFailRate && Math.random() < opts.writeFailRate) {
        throw new Error('S3 InternalError: transient write failure')
      }

      if (opts.writeLatencyMs) {
        await sleep(opts.writeLatencyMs)
      }

      // Deep copy to simulate real storage (no shared references)
      objects.set(`${params.Bucket}/${params.Key}`, new Uint8Array(params.Body))
    },

    async getObject(params) {
      readCount++

      if (opts.readLatencyMs) {
        await sleep(opts.readLatencyMs)
      }

      const key = `${params.Bucket}/${params.Key}`
      const data = objects.get(key)
      if (!data) {
        throw new Error('NoSuchKey: The specified key does not exist.')
      }

      // Deep copy — S3 returns a new read each time
      return { Body: new Uint8Array(data) }
    },

    async deleteObject(params) {
      objects.delete(`${params.Bucket}/${params.Key}`)
    },

    async headBucket() {
      // Always available
    },
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Test Suite
// ──────────────────────────────────────────────────────────────────────────────

describe('Cold Storage Pipeline Scenario', () => {
  let agent: Agent
  let quarantine: Quarantine
  let auditChain: AuditChain

  function createThreatScent(index: number): Scent {
    return {
      id: generateSecureId(),
      timestamp: Date.now(),
      source: `attacker-${index % 50}`,
      payload: {
        attack: `injection-variant-${index}`,
        vector: `input-field-${index % 10}`,
        data: `payload-content-${index}-${'x'.repeat(200)}`,
      },
      threat: {
        category: 'injection',
        severity:
          index % 4 === 0
            ? 'critical'
            : index % 3 === 0
            ? 'high'
            : index % 2 === 0
            ? 'medium'
            : 'low',
      },
    }
  }

  beforeEach(() => {
    auditChain = new AuditChain()
    quarantine = new Quarantine(
      { maxCount: 200, maxBytes: 50_000_000, evictionPolicy: 'priority' },
      auditChain
    )
    const rateLimiter = createRateLimiter({
      windowMs: 60_000,
      maxRequests: 10_000,
      blockDurationMs: 1000,
    })
    const evidenceFactory = createEvidenceFactory()

    agent = createAgent(
      { maxPayloadSize: 10_000_000 },
      quarantine,
      rateLimiter,
      evidenceFactory
    ) as Agent
  })

  // ──────────────────────────────────────────────────────────────────────
  // Single Evidence Full Pipeline
  // ──────────────────────────────────────────────────────────────────────

  it('should preserve evidence through full pipeline: Agent → S3 → Read → Verify → Decode', async () => {
    const mockS3 = createRealisticMockS3()
    const storage = new S3ColdStorage({ client: mockS3, bucket: 'evidence' })

    // Step 1: Agent intercepts threat
    const scent = createThreatScent(42)
    const result = agent.intercept(scent)
    expect(result.status).toBe('quarantined')

    // Step 2: Get the raw payload and encode async for cold storage
    const rawPayload = new TextEncoder().encode(JSON.stringify(scent.payload))
    const encoded = await encodeWithIntegrityAsync(rawPayload)

    // Step 3: Write to S3
    const writeResult = await storage.write('ev-42', encoded)
    expect(writeResult.success).toBe(true)

    // Step 4: Read back from S3
    const readResult = await storage.read('ev-42')
    expect(readResult.success).toBe(true)
    expect(readResult.payload).toBeDefined()

    // Step 5: Verify integrity (tamper detection)
    expect(verify(readResult.payload!)).toBe(true)

    // Step 6: Decode async
    const decoded = await decodeWithIntegrityAsync(readResult.payload!)

    // Step 7: Assert original data intact
    const recoveredPayload = JSON.parse(new TextDecoder().decode(decoded))
    expect(recoveredPayload).toEqual(scent.payload)
  })

  // ──────────────────────────────────────────────────────────────────────
  // Batch Evacuation
  // ──────────────────────────────────────────────────────────────────────

  it('should evacuate 100 evidence items to cold storage and recover all', async () => {
    const mockS3 = createRealisticMockS3({ writeLatencyMs: 1, readLatencyMs: 1 })
    const storage = new S3ColdStorage({ client: mockS3, bucket: 'evidence' })

    const originalPayloads = new Map<string, Record<string, unknown>>()

    // Phase 1: Fill quarantine with 100 threats
    for (let i = 0; i < 100; i++) {
      const scent = createThreatScent(i)
      agent.intercept(scent)
      originalPayloads.set(`ev-${i}`, scent.payload as Record<string, unknown>)
    }

    // Phase 2: Batch evacuate — encode + write all concurrently
    const writePromises: Promise<void>[] = []
    for (const [id, payload] of originalPayloads) {
      const p = (async () => {
        const raw = new TextEncoder().encode(JSON.stringify(payload))
        const encoded = await encodeWithIntegrityAsync(raw)
        const result = await storage.write(id, encoded)
        expect(result.success).toBe(true)
      })()
      writePromises.push(p)
    }
    await Promise.all(writePromises)

    expect(mockS3.writeCount).toBe(100)

    // Phase 3: Read back all concurrently and verify
    const readPromises = Array.from(originalPayloads.keys()).map(async (id) => {
      const readResult = await storage.read(id)
      expect(readResult.success).toBe(true)
      expect(verify(readResult.payload!)).toBe(true)

      const decoded = await decodeWithIntegrityAsync(readResult.payload!)
      const recovered = JSON.parse(new TextDecoder().decode(decoded))
      expect(recovered).toEqual(originalPayloads.get(id))
    })
    await Promise.all(readPromises)

    expect(mockS3.readCount).toBe(100)
  })

  // ──────────────────────────────────────────────────────────────────────
  // Concurrent Read/Write Contention
  // ──────────────────────────────────────────────────────────────────────

  it('should handle concurrent reads and writes to same storage', async () => {
    const mockS3 = createRealisticMockS3({ writeLatencyMs: 2, readLatencyMs: 1 })
    const storage = new S3ColdStorage({ client: mockS3, bucket: 'evidence' })

    // Pre-populate 10 items
    for (let i = 0; i < 10; i++) {
      const raw = new TextEncoder().encode(`pre-existing-evidence-${i}`)
      const encoded = await encodeWithIntegrityAsync(raw)
      await storage.write(`existing-${i}`, encoded)
    }

    // Simultaneously: write 20 new + read 10 existing
    const ops: Promise<void>[] = []

    // Writes
    for (let i = 0; i < 20; i++) {
      ops.push((async () => {
        const raw = new TextEncoder().encode(`new-evidence-${i}`)
        const encoded = await encodeWithIntegrityAsync(raw)
        const result = await storage.write(`new-${i}`, encoded)
        expect(result.success).toBe(true)
      })())
    }

    // Reads
    for (let i = 0; i < 10; i++) {
      ops.push((async () => {
        const result = await storage.read(`existing-${i}`)
        expect(result.success).toBe(true)
        expect(verify(result.payload!)).toBe(true)
      })())
    }

    await Promise.all(ops)

    // All 30 items should be in storage
    expect(mockS3.objects.size).toBe(30)
  })

  // ──────────────────────────────────────────────────────────────────────
  // Storage Failure Mid-Batch (Partial Evacuation)
  // ──────────────────────────────────────────────────────────────────────

  it('should gracefully handle partial evacuation when S3 fails mid-batch', async () => {
    // S3 fails after 15 writes
    const mockS3 = createRealisticMockS3({ failAfterWrites: 15 })
    const storage = new S3ColdStorage({ client: mockS3, bucket: 'evidence' })

    const results: { id: string; success: boolean }[] = []

    // Try to evacuate 30 items
    for (let i = 0; i < 30; i++) {
      const raw = new TextEncoder().encode(`evacuation-${i}`)
      const encoded = await encodeWithIntegrityAsync(raw)
      const result = await storage.write(`evac-${i}`, encoded)
      results.push({ id: `evac-${i}`, success: result.success })
    }

    // First 15 should succeed
    const succeeded = results.filter((r) => r.success)
    const failed = results.filter((r) => !r.success)

    expect(succeeded.length).toBe(15)
    expect(failed.length).toBe(15)

    // Successful writes should be readable
    for (const { id } of succeeded) {
      const readResult = await storage.read(id)
      expect(readResult.success).toBe(true)
      expect(verify(readResult.payload!)).toBe(true)
    }

    // Failed writes should return not found
    for (const { id } of failed) {
      const readResult = await storage.read(id)
      expect(readResult.success).toBe(false)
    }
  })

  // ──────────────────────────────────────────────────────────────────────
  // Overwrite Semantics
  // ──────────────────────────────────────────────────────────────────────

  it('should correctly overwrite evidence on re-write with different data', async () => {
    const mockS3 = createRealisticMockS3()
    const storage = new S3ColdStorage({ client: mockS3, bucket: 'evidence' })

    // Write version 1
    const raw1 = new TextEncoder().encode('evidence-v1')
    const encoded1 = await encodeWithIntegrityAsync(raw1)
    await storage.write('overwrite-test', encoded1)

    // Write version 2 to same key
    const raw2 = new TextEncoder().encode('evidence-v2-updated-with-more-data')
    const encoded2 = await encodeWithIntegrityAsync(raw2)
    await storage.write('overwrite-test', encoded2)

    // Read should return version 2
    const readResult = await storage.read('overwrite-test')
    expect(readResult.success).toBe(true)
    expect(verify(readResult.payload!)).toBe(true)

    const decoded = await decodeWithIntegrityAsync(readResult.payload!)
    expect(new TextDecoder().decode(decoded)).toBe('evidence-v2-updated-with-more-data')
  })

  // ──────────────────────────────────────────────────────────────────────
  // Delete + Read Consistency
  // ──────────────────────────────────────────────────────────────────────

  it('should return not-found after delete', async () => {
    const mockS3 = createRealisticMockS3()
    const storage = new S3ColdStorage({ client: mockS3, bucket: 'evidence' })

    const raw = new TextEncoder().encode('delete-me')
    const encoded = await encodeWithIntegrityAsync(raw)
    await storage.write('del-test', encoded)

    // Confirm exists
    const read1 = await storage.read('del-test')
    expect(read1.success).toBe(true)

    // Delete
    const deleted = await storage.delete('del-test')
    expect(deleted).toBe(true)

    // Confirm gone
    const read2 = await storage.read('del-test')
    expect(read2.success).toBe(false)
    expect(read2.error).toContain('NoSuchKey')
  })

  // ──────────────────────────────────────────────────────────────────────
  // Pipeline Latency Measurement
  // ──────────────────────────────────────────────────────────────────────

  it('should measure full pipeline latency', async () => {
    const mockS3 = createRealisticMockS3() // no artificial latency
    const storage = new S3ColdStorage({ client: mockS3, bucket: 'evidence' })
    const ITERATIONS = 50

    const latencies: number[] = []

    for (let i = 0; i < ITERATIONS; i++) {
      const raw = new TextEncoder().encode(`latency-test-${i}-${'L'.repeat(300)}`)

      const start = performance.now()

      // Full pipeline: encode → write → read → verify → decode
      const encoded = await encodeWithIntegrityAsync(raw)
      await storage.write(`lat-${i}`, encoded)
      const readResult = await storage.read(`lat-${i}`)
      const valid = verify(readResult.payload!)
      const decoded = await decodeWithIntegrityAsync(readResult.payload!)

      const elapsed = performance.now() - start
      latencies.push(elapsed)

      expect(valid).toBe(true)
      expect(decoded).toEqual(raw)
    }

    latencies.sort((a, b) => a - b)
    const p50 = latencies[Math.floor(latencies.length * 0.5)]
    const p99 = latencies[Math.floor(latencies.length * 0.99)]

    console.log(`=== Cold Storage Pipeline Latency ===`)
    console.log(`p50: ${p50!.toFixed(3)}ms, p99: ${p99!.toFixed(3)}ms`)
    console.log(`=====================================`)

    // Pipeline should complete in reasonable time (no artificial latency in mock)
    expect(p99).toBeLessThan(500) // generous ceiling for CI
  })
})
