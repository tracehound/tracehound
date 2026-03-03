import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  clearTraceInspectionHistory,
  clearTraceRegistryDisk,
  findTraceInspectionEntryBySignature,
  getTraceInspectionEntry,
  getTraceRegistryStats,
  listTraceInspectionEntries,
  recordTraceInspectionEntry,
} from '../src/utils/trace-registry.js'

describe('trace inspection registry', () => {
  it('records and resolves entry by trace id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracehound-registry-test-'))
    const path = join(dir, 'trace-registry.ndjson')

    try {
      const recorded = recordTraceInspectionEntry(
        {
          traceId: 'trace-1',
          signature: 'injection:sig-1',
          severity: 'high',
          size: 1024,
          captured: Date.now(),
          source: '127.0.0.1',
        },
        { path },
      )

      expect(recorded).not.toBeNull()
      const resolved = getTraceInspectionEntry('trace-1', { path })
      expect(resolved).not.toBeNull()
      expect(resolved?.traceId).toBe('trace-1')
      expect(resolved?.signature).toBe('injection:sig-1')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('finds entry by signature', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracehound-registry-test-'))
    const path = join(dir, 'trace-registry.ndjson')

    try {
      recordTraceInspectionEntry(
        {
          traceId: 'trace-2',
          signature: 'ddos:sig-2',
          severity: 'medium',
          size: 2048,
          captured: Date.now(),
          source: '10.0.0.1',
        },
        { path },
      )

      const resolved = findTraceInspectionEntryBySignature('ddos:sig-2', { path })
      expect(resolved).not.toBeNull()
      expect(resolved?.traceId).toBe('trace-2')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('lists latest entries with limit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracehound-registry-test-'))
    const path = join(dir, 'trace-registry.ndjson')

    try {
      recordTraceInspectionEntry(
        {
          traceId: 'trace-a',
          signature: 'injection:a',
          severity: 'low',
          size: 100,
          captured: Date.now(),
          source: 'source-a',
        },
        { path },
      )
      recordTraceInspectionEntry(
        {
          traceId: 'trace-b',
          signature: 'injection:b',
          severity: 'high',
          size: 200,
          captured: Date.now(),
          source: 'source-b',
        },
        { path },
      )

      const entries = listTraceInspectionEntries(1, { path })
      expect(entries).toHaveLength(1)
      expect(entries[0]?.traceId).toBe('trace-b')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns registry stats including queue and retention config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracehound-registry-test-'))
    const path = join(dir, 'trace-registry.ndjson')

    try {
      recordTraceInspectionEntry(
        {
          traceId: 'trace-stats-1',
          signature: 'injection:stats-1',
          severity: 'medium',
          size: 512,
          captured: Date.now(),
          source: 'source-stats',
        },
        { path },
      )

      const stats = getTraceRegistryStats({ path })
      expect(stats.path).toBe(path)
      expect(stats.retainedEntries).toBeGreaterThan(0)
      expect(stats.uniqueTraceIds).toBeGreaterThan(0)
      expect(stats.maxEntries).toBeGreaterThan(0)
      expect(stats.maxQueueEntries).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('clears history explicitly while keeping registry path reusable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracehound-registry-test-'))
    const path = join(dir, 'trace-registry.ndjson')

    try {
      recordTraceInspectionEntry(
        {
          traceId: 'trace-clear-1',
          signature: 'injection:clear-1',
          severity: 'low',
          size: 64,
          captured: Date.now(),
          source: 'source-clear',
        },
        { path },
      )

      const cleared = clearTraceInspectionHistory({ path })
      expect(cleared.success).toBe(true)
      expect(cleared.mode).toBe('history')
      expect(cleared.removedEntries).toBeGreaterThan(0)

      const entriesAfter = listTraceInspectionEntries(10, { path })
      expect(entriesAfter).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('clears registry file from disk explicitly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracehound-registry-test-'))
    const path = join(dir, 'trace-registry.ndjson')

    try {
      writeFileSync(
        path,
        JSON.stringify({
          traceId: 'trace-disk-1',
          signature: 'ddos:disk-1',
          severity: 'high',
          size: 1024,
          captured: Date.now(),
          source: 'source-disk',
          recordedAt: Date.now(),
        }) + '\n',
        'utf8',
      )

      const cleared = clearTraceRegistryDisk({ path })
      expect(cleared.success).toBe(true)
      expect(cleared.mode).toBe('disk')
      expect(cleared.removedBytes).toBeGreaterThan(0)

      const statsAfter = getTraceRegistryStats({ path })
      expect(statsAfter.fileExists).toBe(false)
      expect(statsAfter.fileBytes).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
