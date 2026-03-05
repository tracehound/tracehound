/**
 * Tests for tracehound.ts - Main API factory
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { encodeHoundMessage } from '../src/core/hound-ipc.js'
import { createMockAdapter } from '../src/core/hound-pool.js'
import { createTracehound } from '../src/core/tracehound.js'
import { readSystemSnapshotFromDisk } from '../src/utils/system-snapshot.js'

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
    it('watcher.snapshot() reflects real threats intercepted by agent', () => {
      const tracehound = createTracehound()
      tracehound.agent.intercept({
        id: '1',
        timestamp: Date.now(),
        source: '1.2.3.4',
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
        source: '1.2.3.4',
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
        source: '1.2.3.4',
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
        source: '1.2.3.5',
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
      expect(panics.some((panic) => panic.reason.includes('hound_error'))).toBe(true)
      tracehound.shutdown()
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
      const previousSnapshotSecret = process.env['TRACEHOUND_SNAPSHOT_SECRET']

      try {
        delete process.env['TRACEHOUND_SNAPSHOT_SECRET']

        expect(() =>
          createTracehound({
            snapshot: { path },
          }),
        ).toThrow()
      } finally {
        if (previousSnapshotSecret === undefined) {
          delete process.env['TRACEHOUND_SNAPSHOT_SECRET']
        } else {
          process.env['TRACEHOUND_SNAPSHOT_SECRET'] = previousSnapshotSecret
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
      const internals = tracehound as unknown as { startSnapshotLoop: () => void }
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
        expect(panics.some((panic) => panic.reason === 'snapshot_cleanup_failed')).toBe(true)
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
        expect(panics.some((panic) => panic.reason === 'snapshot_write_failed')).toBe(true)

        tracehound.shutdown()
      } finally {
        rmSync(dir, { recursive: true, force: true })
        vi.useRealTimers()
      }
    })
  })
})
