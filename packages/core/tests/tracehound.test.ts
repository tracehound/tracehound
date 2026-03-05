/**
 * Tests for tracehound.ts - Main API factory
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
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
  })
})
