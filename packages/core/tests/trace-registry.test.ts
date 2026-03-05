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
  resolveTraceRegistryPath,
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

  it('resolves registry path by option, env, then default', () => {
    const previous = process.env.TRACEHOUND_TRACE_REGISTRY_PATH
    const envPath = join(tmpdir(), 'tracehound-env-registry.ndjson')
    const optionPath = join(tmpdir(), 'tracehound-option-registry.ndjson')

    try {
      process.env.TRACEHOUND_TRACE_REGISTRY_PATH = envPath
      expect(resolveTraceRegistryPath({ path: optionPath })).toBe(optionPath)
      expect(resolveTraceRegistryPath()).toBe(envPath)

      delete process.env.TRACEHOUND_TRACE_REGISTRY_PATH
      expect(resolveTraceRegistryPath()).toContain(join('tracehound', 'trace-registry.ndjson'))
    } finally {
      if (previous === undefined) {
        delete process.env.TRACEHOUND_TRACE_REGISTRY_PATH
      } else {
        process.env.TRACEHOUND_TRACE_REGISTRY_PATH = previous
      }
    }
  })

  it('returns null for invalid write/read inputs', () => {
    const invalidRecord = recordTraceInspectionEntry({
      traceId: '',
      signature: 'sig',
      severity: 'high',
      size: 1,
      captured: Date.now(),
      source: 'src',
    })
    expect(invalidRecord).toBeNull()

    expect(getTraceInspectionEntry('', {})).toBeNull()
    expect(findTraceInspectionEntryBySignature('', {})).toBeNull()
  })

  it('normalizes invalid list limit and deduplicates by latest trace id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracehound-registry-test-'))
    const path = join(dir, 'trace-registry.ndjson')
    const now = Date.now()
    const lines = [
      {
        traceId: 'trace-dup',
        signature: 'sig-old',
        severity: 'low',
        size: 1,
        captured: now - 200,
        source: 'src-old',
        recordedAt: now - 200,
      },
      {
        traceId: 'trace-unique',
        signature: 'sig-unique',
        severity: 'medium',
        size: 2,
        captured: now - 100,
        source: 'src-unique',
        recordedAt: now - 100,
      },
      {
        traceId: 'trace-dup',
        signature: 'sig-new',
        severity: 'high',
        size: 3,
        captured: now,
        source: 'src-new',
        recordedAt: now,
      },
    ]

    try {
      writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8')
      const list = listTraceInspectionEntries(0, { path })

      expect(list).toHaveLength(2)
      expect(list[0]?.traceId).toBe('trace-dup')
      expect(list[0]?.signature).toBe('sig-new')
      expect(list[1]?.traceId).toBe('trace-unique')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('filters malformed and expired lines and enforces maxEntries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracehound-registry-test-'))
    const path = join(dir, 'trace-registry.ndjson')
    const now = Date.now()
    const lines = [
      JSON.stringify({
        traceId: 'trace-expired',
        signature: 'sig-expired',
        severity: 'low',
        size: 1,
        captured: now - 5_000,
        source: 'src-expired',
        recordedAt: now - 5_000,
      }),
      '{',
      JSON.stringify({
        traceId: 'trace-1',
        signature: 'sig-1',
        severity: 'low',
        size: 1,
        captured: now - 30,
        source: 'src-1',
        recordedAt: now - 30,
      }),
      JSON.stringify({
        traceId: 'trace-2',
        signature: 'sig-2',
        severity: 'medium',
        size: 2,
        captured: now - 20,
        source: 'src-2',
        recordedAt: now - 20,
      }),
      JSON.stringify({
        traceId: 'trace-3',
        signature: 'sig-3',
        severity: 'high',
        size: 3,
        captured: now - 10,
        source: 'src-3',
        recordedAt: now - 10,
      }),
    ]

    try {
      writeFileSync(path, `${lines.join('\n')}\n`, 'utf8')
      const list = listTraceInspectionEntries(10, { path, ttlMs: 100, maxEntries: 2 })

      expect(list).toHaveLength(2)
      expect(list[0]?.traceId).toBe('trace-3')
      expect(list[1]?.traceId).toBe('trace-2')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('drops queued entries when maxQueueEntries is exceeded', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracehound-registry-test-'))
    const path = join(dir, 'trace-registry.ndjson')

    try {
      recordTraceInspectionEntry(
        {
          traceId: 'trace-q-1',
          signature: 'sig-q-1',
          severity: 'low',
          size: 1,
          captured: Date.now(),
          source: 'src-q',
        },
        { path, maxQueueEntries: 1 },
      )
      recordTraceInspectionEntry(
        {
          traceId: 'trace-q-2',
          signature: 'sig-q-2',
          severity: 'high',
          size: 1,
          captured: Date.now(),
          source: 'src-q',
        },
        { path, maxQueueEntries: 1 },
      )

      const stats = getTraceRegistryStats({ path, maxQueueEntries: 1 })
      expect(stats.droppedCount).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('blocks writes when file size limit is reached and reports blocked stats', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracehound-registry-test-'))
    const path = join(dir, 'trace-registry.ndjson')

    try {
      writeFileSync(path, 'x', 'utf8')
      recordTraceInspectionEntry(
        {
          traceId: 'trace-blocked-1',
          signature: 'sig-blocked-1',
          severity: 'critical',
          size: 1,
          captured: Date.now(),
          source: 'src-blocked',
        },
        { path, maxFileBytes: 1 },
      )

      for (let i = 0; i < 25; i++) {
        await new Promise<void>((resolve) => setImmediate(resolve))
        if (getTraceRegistryStats({ path, maxFileBytes: 1 }).blocked) {
          break
        }
      }

      const stats = getTraceRegistryStats({ path, maxFileBytes: 1 })
      expect(stats.blocked).toBe(true)
      expect(stats.droppedCount).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps clear operations successful when file does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracehound-registry-test-'))
    const path = join(dir, 'trace-registry.ndjson')

    try {
      const history = clearTraceInspectionHistory({ path })
      expect(history.success).toBe(true)
      expect(history.removedBytes).toBe(0)
      expect(history.removedEntries).toBe(0)

      const disk = clearTraceRegistryDisk({ path })
      expect(disk.success).toBe(true)
      expect(disk.removedBytes).toBe(0)
      expect(disk.removedEntries).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
