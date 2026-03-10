/**
 * Tests for tracehound.ts - Main API factory
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { encodeHoundMessage } from '../src/core/hound-ipc.js'
import {
  createMockAdapter,
  HOUND_PRESSURE_ERRORS,
  type HoundResult,
} from '../src/core/hound-pool.js'
import { formatHoundErrorReason, SYSTEM_PANIC_REASONS } from '../src/core/operational-events.js'
import { createTracehound } from '../src/core/tracehound.js'
import { readSystemSnapshotFromDisk, SYSTEM_SNAPSHOT_ENV } from '../src/utils/system-snapshot.js'

async function flushMicrotasks(): Promise<void> {
  const vitestTimers = vi as unknown as {
    isFakeTimers?: () => boolean
    runAllTicks?: () => void
  }
  if (typeof vitestTimers.isFakeTimers === 'function' && vitestTimers.isFakeTimers()) {
    if (typeof vitestTimers.runAllTicks === 'function') {
      vitestTimers.runAllTicks()
    }

    // Always await an async boundary so queued microtasks are observed before assertions.
    await Promise.resolve()
    return
  }

  await new Promise<void>((resolve) => queueMicrotask(resolve))
}

describe('Tracehound Factory', () => {
  describe('createTracehound', () => {
    it('should create tracehound instance with default config', () => {
      const tracehound = createTracehound()

      expect(tracehound).toBeDefined()
      expect(tracehound.agent).toBeDefined()
      expect(tracehound.quarantine).toBeDefined()
      expect(tracehound.rateLimiter).toBeDefined()
      expect(tracehound.watcher).toBeDefined()
      expect(tracehound.auditChain).toBeDefined()
      expect(tracehound.notifications).toBeDefined()
      expect(tracehound.houndPool).toBeDefined()
    })

    it('should accept custom maxPayloadSize', () => {
      const tracehound = createTracehound({
        maxPayloadSize: 500_000,
      })

      expect(tracehound.agent).toBeDefined()
    })

    it('should accept custom quarantine config', () => {
      const tracehound = createTracehound({
        quarantine: {
          maxCount: 5000,
          maxBytes: 50_000_000,
        },
      })

      expect(tracehound.quarantine).toBeDefined()
      expect(tracehound.quarantine.stats.count).toBe(0)
    })

    it('provisions cold storage when TTL decay is enabled', () => {
      const tracehound = createTracehound({
        quarantine: {
          ttlMs: 100,
          decayIntervalMs: 25,
        },
      })

      expect(tracehound.coldStorage).not.toBeNull()
      tracehound.shutdown()
    })

    it('should accept custom rate limit config', () => {
      const tracehound = createTracehound({
        rateLimit: {
          windowMs: 30_000,
          maxRequests: 50,
          blockDurationMs: 60_000,
        },
      })

      expect(tracehound.rateLimiter).toBeDefined()
    })

    it('should accept custom watcher config', () => {
      const tracehound = createTracehound({
        watcher: {
          maxAlertsPerWindow: 5,
          alertWindowMs: 10_000,
          quarantineHighWatermark: 0.9,
        },
      })

      expect(tracehound.watcher).toBeDefined()
    })

    it('should accept custom hound pool config', () => {
      const tracehound = createTracehound({
        houndPool: {
          poolSize: 2,
          timeout: 15_000,
          rotationJitterMs: 500,
          onPoolExhausted: 'drop',
        },
      })

      expect(tracehound.houndPool).toBeDefined()
    })

    it('should use default values when config not provided', () => {
      const tracehound = createTracehound({})

      expect(tracehound.quarantine).toBeDefined()
      expect(tracehound.quarantine.stats.count).toBe(0)
    })

    it('should initialize all components correctly', () => {
      const tracehound = createTracehound()

      // Verify components are initialized and connected
      expect(tracehound.auditChain.length).toBe(0)
      expect(tracehound.notifications.stats.totalEmitted).toBe(0)
      expect(tracehound.quarantine.stats.count).toBe(0)
    })
  })

  describe('Internal Wiring', () => {
    it('decays expired quarantine entries in the background when TTL is enabled', async () => {
      // Exclude setImmediate/clearImmediate from faking so they remain real
      // event loop yields — needed to let the libuv gzip thread-pool callback
      // (from encodeWithIntegrityAsync) fire in the poll phase before assertions run.
      vi.useFakeTimers({
        toFake: ['Date', 'hrtime', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
      })
      const tracehound = createTracehound({
        quarantine: {
          ttlMs: 10,
          decayIntervalMs: 5,
        },
      })

      try {
        const result = tracehound.agent.intercept({
          id: 'ttl-1',
          timestamp: Date.now(),
          source: { ip: 'ttl-source' },
          threat: { category: 'injection', severity: 'high' },
          payload: { attack: true },
        })

        expect(result.status).toBe('quarantined')
        if (result.status !== 'quarantined' || !tracehound.coldStorage) {
          return
        }

        // Jittered ticks and async archival can complete at different points
        // under fake timers, so poll until decay bookkeeping and archival settle.
        for (
          let attempt = 0;
          attempt < 50 &&
          (tracehound.quarantine.stats.count > 0 ||
            tracehound.quarantine.stats.decayedCount === 0 ||
            tracehound.quarantine.stats.archivedCount === 0);
          attempt++
        ) {
          await vi.advanceTimersByTimeAsync(20)
          await flushMicrotasks()
          // Yield to the real event loop so the libuv gzip thread-pool callback
          // (from encodeWithIntegrityAsync) can fire in the poll phase.
          await new Promise<void>((resolve) => setImmediate(resolve))
          await flushMicrotasks()
        }

        expect(tracehound.quarantine.stats.count).toBe(0)
        expect(tracehound.quarantine.stats.decayedCount).toBe(1)
        expect(tracehound.quarantine.stats.archivedCount).toBe(1)
        expect(tracehound.quarantine.stats.archiveFailureCount).toBe(0)

        const archived = await tracehound.coldStorage.read(result.handle.signature)
        expect(archived.success).toBe(true)
      } finally {
        tracehound.shutdown()
        vi.useRealTimers()
      }
    })

    it('watcher.snapshot() reflects real threats intercepted by agent', () => {
      const tracehound = createTracehound()
      tracehound.agent.intercept({
        id: '1',
        timestamp: Date.now(),
        source: { ip: '1.2.3.4' },
        threat: { category: 'injection', severity: 'critical' },
        payload: {},
      })

      const snapshot = tracehound.watcher.snapshot()
      expect(snapshot.threats.total).toBe(1)
      expect(snapshot.threats.byCategory['injection']).toBe(1)
      expect(snapshot.threats.bySeverity['critical']).toBe(1)
      expect(snapshot.quarantine.count).toBe(1)
    })

    it('notifications fire on threat and quarantine', () => {
      const tracehound = createTracehound()
      let threatFired = false
      let quarantineFired = false

      tracehound.notifications.on('threat.detected', () => {
        threatFired = true
      })
      tracehound.notifications.on('evidence.quarantined', () => {
        quarantineFired = true
      })

      tracehound.agent.intercept({
        id: '2',
        timestamp: Date.now(),
        source: { ip: '1.2.3.4' },
        threat: { category: 'injection', severity: 'high' },
        payload: {},
      })

      expect(threatFired).toBe(true)
      expect(quarantineFired).toBe(true)
      expect(tracehound.notifications.stats.totalEmitted).toBeGreaterThanOrEqual(2)
    })

    it('houndPool timeout flow alerts watcher without private access', async () => {
      vi.useFakeTimers()
      const adapter = createMockAdapter()
      const tracehound = createTracehound({
        houndPool: {
          poolSize: 1,
          timeout: 5,
          rotationJitterMs: 10,
          adapter,
        },
      })

      tracehound.agent.intercept({
        id: '3',
        timestamp: Date.now(),
        source: { ip: '1.2.3.4' },
        threat: { category: 'injection', severity: 'high' },
        payload: { a: 1 },
      })

      await vi.advanceTimersByTimeAsync(6)

      const snapshot = tracehound.watcher.snapshot()
      expect(snapshot.totalAlerts).toBeGreaterThanOrEqual(1)
      expect(snapshot.lastAlert?.type).toBe('hound_timeout')
      tracehound.shutdown()
      vi.useRealTimers()
    })

    it('houndPool error flow emits system_overload alert and panic', () => {
      const adapter = createMockAdapter()
      const tracehound = createTracehound({
        houndPool: {
          poolSize: 1,
          timeout: 1000,
          rotationJitterMs: 10,
          adapter,
        },
      })

      const panics: Array<{ reason: string }> = []
      tracehound.notifications.on('system.panic', (event) => {
        panics.push({ reason: event.payload.reason })
      })

      tracehound.agent.intercept({
        id: '4',
        timestamp: Date.now(),
        source: { ip: '1.2.3.5' },
        threat: { category: 'injection', severity: 'high' },
        payload: { a: 1 },
      })

      const pid = [...adapter.getMockProcesses().keys()][0]
      const errorMessage = encodeHoundMessage({
        type: 'status',
        state: 'error',
        error: 'boom',
      })
      const payload = new Uint8Array(errorMessage.subarray(4)).buffer
      adapter.simulateMessage(pid, payload)

      const snapshot = tracehound.watcher.snapshot()
      expect(snapshot.lastAlert?.type).toBe('system_overload')
      expect(snapshot.overloaded).toBe(false)
      expect(
        panics.some((panic) => panic.reason.startsWith(SYSTEM_PANIC_REASONS.HOUND_ERROR_PREFIX)),
      ).toBe(true)
      tracehound.shutdown()
    })

    it('sets watcher overload when pool is exhausted and clears it after recovery', async () => {
      const adapter = createMockAdapter()
      const tracehound = createTracehound({
        houndPool: {
          poolSize: 1,
          timeout: 1000,
          rotationJitterMs: 10,
          onPoolExhausted: 'drop',
          adapter,
        },
      })

      const first = tracehound.agent.intercept({
        id: '5',
        timestamp: Date.now(),
        source: { ip: '1.2.3.6' },
        threat: { category: 'injection', severity: 'high' },
        payload: { first: true },
      })
      const panics: Array<{ reason: string }> = []
      tracehound.notifications.on('system.panic', (event) => {
        panics.push({ reason: event.payload.reason })
      })

      const second = tracehound.agent.intercept({
        id: '6',
        timestamp: Date.now(),
        source: { ip: '1.2.3.7' },
        threat: { category: 'injection', severity: 'high' },
        payload: { second: true },
      })

      expect(first.status).toBe('quarantined')
      expect(second.status).toBe('quarantined')
      expect(
        panics.some(
          (panic) => panic.reason === formatHoundErrorReason(HOUND_PRESSURE_ERRORS.POOL_EXHAUSTED),
        ),
      ).toBe(true)
      expect(tracehound.watcher.snapshot().overloaded).toBe(true)

      const pid = [...adapter.getMockProcesses().keys()][0]
      const analysisMessage = encodeHoundMessage({
        type: 'analysis',
        hash: 'a1b2c3',
        entropy: 7.1,
        contentType: 'json',
        sizeBytes: 128,
      })
      adapter.simulateMessage(pid, new Uint8Array(analysisMessage.subarray(4)).buffer)

      const completeMessage = encodeHoundMessage({
        type: 'status',
        state: 'complete',
      })
      adapter.simulateMessage(pid, new Uint8Array(completeMessage.subarray(4)).buffer)

      await flushMicrotasks()
      expect(tracehound.watcher.snapshot().overloaded).toBe(false)
      tracehound.shutdown()
    })

    it('does not mark watcher overloaded on forced terminate lifecycle', () => {
      const adapter = createMockAdapter()
      const tracehound = createTracehound({
        houndPool: {
          poolSize: 1,
          timeout: 1000,
          rotationJitterMs: 10,
          adapter,
        },
      })

      const result = tracehound.agent.intercept({
        id: '7',
        timestamp: Date.now(),
        source: { ip: '1.2.3.8' },
        threat: { category: 'injection', severity: 'high' },
        payload: { terminate: true },
      })
      expect(result.status).toBe('quarantined')
      if (result.status !== 'quarantined') {
        tracehound.shutdown()
        return
      }

      tracehound.houndPool.terminate(result.handle.signature)
      expect(tracehound.watcher.snapshot().overloaded).toBe(false)
      tracehound.shutdown()
    })

    it('keeps overload until deferred queue drains under defer pressure', async () => {
      const adapter = createMockAdapter()
      const tracehound = createTracehound({
        houndPool: {
          poolSize: 1,
          timeout: 1000,
          rotationJitterMs: 10,
          onPoolExhausted: 'defer',
          deferQueueLimit: 1,
          adapter,
        },
      })

      const panics: Array<{ reason: string }> = []
      tracehound.notifications.on('system.panic', (event) => {
        panics.push({ reason: event.payload.reason })
      })

      tracehound.agent.intercept({
        id: '8',
        timestamp: Date.now(),
        source: { ip: '1.2.3.9' },
        threat: { category: 'injection', severity: 'high' },
        payload: { first: true },
      })
      tracehound.agent.intercept({
        id: '9',
        timestamp: Date.now(),
        source: { ip: '1.2.3.10' },
        threat: { category: 'injection', severity: 'high' },
        payload: { second: true },
      })
      tracehound.agent.intercept({
        id: '10',
        timestamp: Date.now(),
        source: { ip: '1.2.3.11' },
        threat: { category: 'injection', severity: 'high' },
        payload: { third: true },
      })

      expect(
        panics.some(
          (panic) =>
            panic.reason === formatHoundErrorReason(HOUND_PRESSURE_ERRORS.DEFER_QUEUE_FULL),
        ),
      ).toBe(true)
      expect(tracehound.watcher.snapshot().overloaded).toBe(true)

      const pid = [...adapter.getMockProcesses().keys()][0]
      const analysisMessage = encodeHoundMessage({
        type: 'analysis',
        hash: 'a1b2c3',
        entropy: 7.1,
        contentType: 'json',
        sizeBytes: 128,
      })
      const completeMessage = encodeHoundMessage({
        type: 'status',
        state: 'complete',
      })

      adapter.simulateMessage(pid, new Uint8Array(analysisMessage.subarray(4)).buffer)
      adapter.simulateMessage(pid, new Uint8Array(completeMessage.subarray(4)).buffer)
      await flushMicrotasks()
      expect(tracehound.watcher.snapshot().overloaded).toBe(true)

      adapter.simulateMessage(pid, new Uint8Array(analysisMessage.subarray(4)).buffer)
      adapter.simulateMessage(pid, new Uint8Array(completeMessage.subarray(4)).buffer)
      await flushMicrotasks()
      expect(tracehound.watcher.snapshot().overloaded).toBe(false)

      tracehound.shutdown()
    })

    it('clears overload after timeout recovers capacity in drop mode', async () => {
      vi.useFakeTimers()
      const adapter = createMockAdapter()
      const tracehound = createTracehound({
        houndPool: {
          poolSize: 1,
          timeout: 5,
          rotationJitterMs: 10,
          onPoolExhausted: 'drop',
          adapter,
        },
      })

      try {
        tracehound.agent.intercept({
          id: '11',
          timestamp: Date.now(),
          source: { ip: '1.2.3.12' },
          threat: { category: 'injection', severity: 'high' },
          payload: { first: true },
        })
        tracehound.agent.intercept({
          id: '12',
          timestamp: Date.now(),
          source: { ip: '1.2.3.13' },
          threat: { category: 'injection', severity: 'high' },
          payload: { second: true },
        })

        expect(tracehound.watcher.snapshot().overloaded).toBe(true)
        await vi.advanceTimersByTimeAsync(6)
        await flushMicrotasks()
        expect(tracehound.watcher.snapshot().overloaded).toBe(false)
      } finally {
        tracehound.shutdown()
        vi.useRealTimers()
      }
    })

    it('marks overload on descriptive spawn failure errors', () => {
      const adapter = createMockAdapter()
      const originalSpawn = adapter.spawn
      adapter.spawn = ((...args: Parameters<typeof originalSpawn>) => {
        void args
        throw new Error('Failed to spawn process: access denied')
      }) as typeof originalSpawn

      const tracehound = createTracehound({
        houndPool: {
          poolSize: 1,
          timeout: 1000,
          rotationJitterMs: 10,
          adapter,
        },
      })

      tracehound.agent.intercept({
        id: '13',
        timestamp: Date.now(),
        source: { ip: '1.2.3.14' },
        threat: { category: 'injection', severity: 'high' },
        payload: { spawn: true },
      })

      expect(tracehound.watcher.snapshot().overloaded).toBe(true)
      tracehound.shutdown()
    })

    it('sets overload on escalate pressure and clears after capacity recovers', async () => {
      const adapter = createMockAdapter()
      const tracehound = createTracehound({
        houndPool: {
          poolSize: 1,
          timeout: 1000,
          rotationJitterMs: 10,
          onPoolExhausted: 'escalate',
          adapter,
        },
      })

      const panics: Array<{ reason: string }> = []
      tracehound.notifications.on('system.panic', (event) => {
        panics.push({ reason: event.payload.reason })
      })

      const first = tracehound.agent.intercept({
        id: '14',
        timestamp: Date.now(),
        source: { ip: '1.2.3.15' },
        threat: { category: 'injection', severity: 'high' },
        payload: { first: true },
      })
      const second = tracehound.agent.intercept({
        id: '15',
        timestamp: Date.now(),
        source: { ip: '1.2.3.16' },
        threat: { category: 'injection', severity: 'high' },
        payload: { second: true },
      })

      expect(first.status).toBe('quarantined')
      expect(second.status).toBe('quarantined')
      expect(
        panics.some(
          (panic) =>
            panic.reason === formatHoundErrorReason(HOUND_PRESSURE_ERRORS.POOL_EXHAUSTED_ESCALATED),
        ),
      ).toBe(true)
      expect(tracehound.watcher.snapshot().overloaded).toBe(true)

      const pid = [...adapter.getMockProcesses().keys()][0]
      const analysisMessage = encodeHoundMessage({
        type: 'analysis',
        hash: 'a1b2c3',
        entropy: 7.1,
        contentType: 'json',
        sizeBytes: 128,
      })
      const completeMessage = encodeHoundMessage({
        type: 'status',
        state: 'complete',
      })
      adapter.simulateMessage(pid, new Uint8Array(analysisMessage.subarray(4)).buffer)
      adapter.simulateMessage(pid, new Uint8Array(completeMessage.subarray(4)).buffer)

      await flushMicrotasks()
      expect(tracehound.watcher.snapshot().overloaded).toBe(false)
      tracehound.shutdown()
    })

    it('creates the decay scheduler when TTL is enabled without a custom interval', () => {
      const tracehound = createTracehound({
        quarantine: {
          ttlMs: 10,
        },
      })

      const internal = tracehound as unknown as { scheduler: unknown }

      expect(internal.scheduler).not.toBeNull()
      tracehound.shutdown()
    })

    it('skips the decay scheduler when the configured interval is invalid', () => {
      const tracehound = createTracehound({
        quarantine: {
          ttlMs: 10,
          decayIntervalMs: Number.NaN,
        },
      })

      const internal = tracehound as unknown as { scheduler: unknown }

      expect(internal.scheduler).toBeNull()
      tracehound.shutdown()
    })

    it('treats missing error details as recoverable without marking overload', () => {
      const tracehound = createTracehound()
      const internal = tracehound as unknown as {
        shouldEvaluateOverloadRecovery: (result: HoundResult) => boolean
        isOverloadSignal: (result: HoundResult) => boolean
      }
      const result = {
        status: 'error',
        signature: 'sig-no-error',
        durationMs: 1,
        processId: 'hound-1',
      } as HoundResult

      expect(internal.shouldEvaluateOverloadRecovery(result)).toBe(true)
      expect(internal.isOverloadSignal(result)).toBe(false)
      tracehound.shutdown()
    })

    it('ignores non-timeout non-error statuses for overload decisions', () => {
      const tracehound = createTracehound()
      const internal = tracehound as unknown as {
        shouldEvaluateOverloadRecovery: (result: HoundResult) => boolean
        isOverloadSignal: (result: HoundResult) => boolean
      }
      const result = {
        status: 'noop',
        signature: 'sig-noop',
        durationMs: 1,
        processId: 'hound-1',
      } as unknown as HoundResult

      expect(internal.shouldEvaluateOverloadRecovery(result)).toBe(false)
      expect(internal.isOverloadSignal(result)).toBe(false)
      tracehound.shutdown()
    })
  })

  describe('runtime.now wiring', () => {
    it('should pass runtime.now to watcher so uptime is controlled by injected clock', () => {
      let fakeTime = 8_000_000
      const mockNow = (): number => fakeTime

      const tracehound = createTracehound({ runtime: { now: mockNow } })
      try {
        fakeTime += 3_000
        const snapshot = tracehound.watcher.snapshot()
        expect(snapshot.uptimeMs).toBe(3_000)
        expect(snapshot.snapshotTime).toBe(fakeTime)
      } finally {
        tracehound.shutdown()
      }
    })

    it('should pass runtime.now to rate-limiter so window decisions use injected clock', () => {
      let fakeTime = 8_000_000
      const mockNow = (): number => fakeTime

      const tracehound = createTracehound({
        rateLimit: { windowMs: 1_000, maxRequests: 2, blockDurationMs: 0 },
        runtime: { now: mockNow },
      })
      try {
        const source = { ip: '10.0.0.1' }
        tracehound.rateLimiter.check(source)
        tracehound.rateLimiter.check(source)
        expect(tracehound.rateLimiter.check(source).allowed).toBe(false)

        // Advance injected clock past window — should be allowed again
        fakeTime += 1_001
        expect(tracehound.rateLimiter.check(source).allowed).toBe(true)
      } finally {
        tracehound.shutdown()
      }
    })
  })

  describe('Snapshot API', () => {
    it('exposes runtime snapshot via tracehound.snapshot()', () => {
      const tracehound = createTracehound()
      const snapshot = tracehound.snapshot()

      expect(snapshot.generatedAt).toBeGreaterThan(0)
      expect(snapshot.agent.totalIntercepts).toBe(0)
      expect(snapshot.houndPool.totalProcesses).toBeGreaterThan(0)
    })

    it('throws when snapshot export is enabled without secret', () => {
      const dir = mkdtempSync(join(tmpdir(), 'tracehound-snapshot-config-'))
      const path = join(dir, 'snapshot.json')
      const previousSnapshotSecret = process.env[SYSTEM_SNAPSHOT_ENV.SECRET]

      try {
        delete process.env[SYSTEM_SNAPSHOT_ENV.SECRET]

        expect(() =>
          createTracehound({
            snapshot: { path },
          }),
        ).toThrow()
      } finally {
        if (previousSnapshotSecret === undefined) {
          delete process.env[SYSTEM_SNAPSHOT_ENV.SECRET]
        } else {
          process.env[SYSTEM_SNAPSHOT_ENV.SECRET] = previousSnapshotSecret
        }
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('throws when snapshot path is empty', () => {
      expect(() =>
        createTracehound({
          snapshot: {
            path: '',
            secret: 'test-secret',
          },
        }),
      ).toThrow()
    })

    it('throws when snapshot interval is not a positive finite value', () => {
      const dir = mkdtempSync(join(tmpdir(), 'tracehound-snapshot-config-'))
      const path = join(dir, 'snapshot.json')

      try {
        expect(() =>
          createTracehound({
            snapshot: {
              path,
              secret: 'test-secret',
              intervalMs: Number.NaN,
            },
          }),
        ).toThrow()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('writes signed snapshot file when snapshot export is enabled', () => {
      const dir = mkdtempSync(join(tmpdir(), 'tracehound-snapshot-'))
      const path = join(dir, 'snapshot.json')
      const tracehound = createTracehound({
        snapshot: {
          path,
          secret: 'test-secret',
          intervalMs: 1000,
        },
      })

      expect(existsSync(path)).toBe(true)
      const read = readSystemSnapshotFromDisk(path, 'test-secret')
      expect(read.ok).toBe(true)
      tracehound.shutdown()
      rmSync(dir, { recursive: true, force: true })
    })

    it('uses default snapshot interval when intervalMs is omitted', async () => {
      vi.useFakeTimers()
      const dir = mkdtempSync(join(tmpdir(), 'tracehound-snapshot-default-interval-'))
      const path = join(dir, 'snapshot.json')

      try {
        const tracehound = createTracehound({
          snapshot: {
            path,
            secret: 'test-secret',
          },
        })

        rmSync(path, { force: true })
        await vi.advanceTimersByTimeAsync(999)
        expect(existsSync(path)).toBe(false)

        await vi.advanceTimersByTimeAsync(1)
        expect(existsSync(path)).toBe(true)
        tracehound.shutdown()
      } finally {
        rmSync(dir, { recursive: true, force: true })
        vi.useRealTimers()
      }
    })

    it('removes snapshot file on shutdown to prevent stale operational truth', () => {
      const dir = mkdtempSync(join(tmpdir(), 'tracehound-snapshot-cleanup-'))
      const path = join(dir, 'snapshot.json')
      try {
        const tracehound = createTracehound({
          snapshot: {
            path,
            secret: 'test-secret',
            intervalMs: 1000,
          },
        })

        expect(existsSync(path)).toBe(true)
        tracehound.shutdown()
        expect(existsSync(path)).toBe(false)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('shutdown is safe when snapshot export is disabled', () => {
      const tracehound = createTracehound()
      expect(() => tracehound.shutdown()).not.toThrow()
    })

    it('startSnapshotLoop is a no-op when snapshot export is disabled', () => {
      const tracehound = createTracehound()
      const internals = tracehound as unknown as {
        startSnapshotLoop: () => void
      }
      expect(() => internals.startSnapshotLoop()).not.toThrow()
      tracehound.shutdown()
    })

    it('emits snapshot_cleanup_failed panic when cleanup cannot unlink snapshot target', () => {
      const dir = mkdtempSync(join(tmpdir(), 'tracehound-snapshot-cleanup-fail-'))
      const snapshotTarget = join(dir, 'snapshot-target')

      try {
        // Create a directory at snapshot path so unlinkSync throws on shutdown.
        rmSync(snapshotTarget, { recursive: true, force: true })
        mkdirSync(snapshotTarget, { recursive: true })

        const tracehound = createTracehound()
        const internal = tracehound as unknown as { snapshotPath: string }
        internal.snapshotPath = snapshotTarget

        const panics: Array<{ reason: string }> = []
        tracehound.notifications.on('system.panic', (event) => {
          panics.push({ reason: event.payload.reason })
        })

        tracehound.shutdown()
        expect(
          panics.some((panic) => panic.reason === SYSTEM_PANIC_REASONS.SNAPSHOT_CLEANUP_FAILED),
        ).toBe(true)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('stops snapshot writes after shutdown', async () => {
      vi.useFakeTimers()
      const dir = mkdtempSync(join(tmpdir(), 'tracehound-snapshot-stop-'))
      const path = join(dir, 'snapshot.json')

      try {
        const tracehound = createTracehound({
          snapshot: {
            path,
            secret: 'test-secret',
            intervalMs: 100,
          },
        })

        expect(existsSync(path)).toBe(true)
        rmSync(path, { force: true })

        tracehound.shutdown()
        await vi.advanceTimersByTimeAsync(500)

        expect(existsSync(path)).toBe(false)
      } finally {
        rmSync(dir, { recursive: true, force: true })
        vi.useRealTimers()
      }
    })

    it('emits snapshot_write_failed panic when snapshot flush fails', async () => {
      vi.useFakeTimers()
      const dir = mkdtempSync(join(tmpdir(), 'tracehound-snapshot-fail-'))
      const parentFile = join(dir, 'not-a-directory')
      const path = join(parentFile, 'snapshot.json')

      try {
        rmSync(parentFile, { force: true })
        // parent path must be a file so mkdir/flush fails deterministically
        writeFileSync(parentFile, 'x')

        const tracehound = createTracehound({
          snapshot: {
            path,
            secret: 'test-secret',
            intervalMs: 50,
          },
        })

        const panics: Array<{ reason: string }> = []
        tracehound.notifications.on('system.panic', (event) => {
          panics.push({ reason: event.payload.reason })
        })

        await vi.advanceTimersByTimeAsync(100)
        expect(
          panics.some((panic) => panic.reason === SYSTEM_PANIC_REASONS.SNAPSHOT_WRITE_FAILED),
        ).toBe(true)

        tracehound.shutdown()
      } finally {
        rmSync(dir, { recursive: true, force: true })
        vi.useRealTimers()
      }
    })
  })
})
