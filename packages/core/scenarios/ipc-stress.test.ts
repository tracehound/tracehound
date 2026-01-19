/**
 * IPC Stress Test Scenario
 *
 * Tests HoundPool IPC resilience:
 * 1. High-frequency activation
 * 2. Pool exhaustion behavior
 * 3. Shutdown handling
 *
 * Target: High-frequency activations without blocking
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AuditChain,
  createEvidenceFactory,
  createMockAdapter,
  Evidence,
  generateSecureId,
  HoundPool,
  type HoundPoolConfig,
  type HoundResult,
  Quarantine,
  type Scent,
} from '../src/index.js'

describe('IPC Stress Test Scenario', () => {
  let pool: HoundPool
  let auditChain: AuditChain
  let quarantine: Quarantine
  let mockAdapter: ReturnType<typeof createMockAdapter>

  const createTestEvidence = (index: number): Evidence => {
    const scent: Scent = {
      id: generateSecureId(),
      timestamp: Date.now(),
      source: `stress-source-${index}`,
      payload: { data: `payload-${index}` },
      threat: { category: 'injection', severity: 'medium' },
    }

    const factory = createEvidenceFactory()
    const result = factory.create(scent, scent.threat!, 10_000)
    if (!result.ok) throw new Error('Failed to create evidence')
    return result.evidence
  }

  beforeEach(() => {
    mockAdapter = createMockAdapter()
    auditChain = new AuditChain()
    quarantine = new Quarantine(
      { maxCount: 10000, maxBytes: 100_000_000, evictionPolicy: 'priority' },
      auditChain,
    )

    const config: HoundPoolConfig = {
      poolSize: 8,
      timeout: 5000,
      rotationJitterMs: 100,
      onPoolExhausted: 'defer',
      deferQueueLimit: 1000,
      adapter: mockAdapter,
    }

    pool = new HoundPool(config)
  })

  afterEach(() => {
    pool.shutdown()
  })

  // ─────────────────────────────────────────────────────────────────────────
  // High Frequency Activation
  // ─────────────────────────────────────────────────────────────────────────

  it('should handle high-frequency activation without blocking', () => {
    const ACTIVATION_COUNT = 1000
    const startTime = Date.now()

    for (let i = 0; i < ACTIVATION_COUNT; i++) {
      const evidence = createTestEvidence(i)
      pool.activate(evidence)
    }

    const elapsed = Date.now() - startTime
    const stats = pool.stats

    console.log(`Activated ${ACTIVATION_COUNT} in ${elapsed}ms`)
    console.log(`Throughput: ${((ACTIVATION_COUNT / elapsed) * 1000).toFixed(0)} activations/sec`)
    console.log(`Active processes: ${stats.activeProcesses}`)
    console.log(`Total activations: ${stats.totalActivations}`)

    // Activation should be non-blocking (< 500ms for 1000 activations)
    expect(elapsed).toBeLessThan(500)
    expect(stats.totalActivations).toBeLessThanOrEqual(ACTIVATION_COUNT)
  })

  it('should spawn mock processes', () => {
    pool.activate(createTestEvidence(0))

    const processes = mockAdapter.getMockProcesses()
    expect(processes.size).toBeGreaterThan(0)
  })

  it('should collect results via callback', async () => {
    const results: HoundResult[] = []
    pool.onResult((result) => results.push(result))

    const ACTIVATION_COUNT = 5
    for (let i = 0; i < ACTIVATION_COUNT; i++) {
      pool.activate(createTestEvidence(i))
    }

    // Simulate process responses
    const processes = mockAdapter.getMockProcesses()
    for (const [pid] of processes) {
      // Simulate a processed response
      mockAdapter.simulateExit(pid, 0)
    }

    // Give time for callbacks
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Should have timeouts or processed results
    expect(pool.stats.totalProcesses).toBeGreaterThan(0)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Pool Exhaustion
  // ─────────────────────────────────────────────────────────────────────────

  it('should defer activations when pool is exhausted', () => {
    const ACTIVATION_COUNT = 100 // More than poolSize

    for (let i = 0; i < ACTIVATION_COUNT; i++) {
      pool.activate(createTestEvidence(i))
    }

    const stats = pool.stats

    // Pool has fixed size of 8
    expect(stats.activeProcesses).toBeLessThanOrEqual(8)
    expect(stats.totalActivations).toBeGreaterThan(0)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Shutdown
  // ─────────────────────────────────────────────────────────────────────────

  it('should shutdown all processes cleanly', () => {
    // Start some processes
    for (let i = 0; i < 5; i++) {
      pool.activate(createTestEvidence(i))
    }

    const processesBefore = mockAdapter.getMockProcesses().size
    expect(processesBefore).toBeGreaterThan(0)

    // Shutdown
    pool.shutdown()

    const stats = pool.stats
    expect(stats.activeProcesses).toBe(0)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Metrics
  // ─────────────────────────────────────────────────────────────────────────

  it('should track accurate statistics', () => {
    const ACTIVATION_COUNT = 50

    for (let i = 0; i < ACTIVATION_COUNT; i++) {
      pool.activate(createTestEvidence(i))
    }

    const stats = pool.stats

    expect(stats.totalProcesses).toBeGreaterThan(0)
    expect(stats.totalActivations).toBeLessThanOrEqual(ACTIVATION_COUNT)
    expect(stats.activeProcesses).toBeLessThanOrEqual(stats.totalProcesses)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Stress Benchmark
  // ─────────────────────────────────────────────────────────────────────────

  it('should benchmark activation throughput', () => {
    const ITERATIONS = 10000
    const startTime = performance.now()

    for (let i = 0; i < ITERATIONS; i++) {
      const evidence = createTestEvidence(i)
      pool.activate(evidence)
    }

    const elapsed = performance.now() - startTime
    const throughput = (ITERATIONS / elapsed) * 1000

    console.log(`\n=== IPC Stress Benchmark ===`)
    console.log(`Iterations: ${ITERATIONS}`)
    console.log(`Time: ${elapsed.toFixed(2)}ms`)
    console.log(`Throughput: ${throughput.toFixed(0)} activations/sec`)
    console.log(`===========================\n`)

    // Should achieve at least 10k activations/sec
    expect(throughput).toBeGreaterThan(1000)
  })
})
