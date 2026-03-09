/**
 * Cold Storage Adapter tests.
 */

import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryColdStorage, createMemoryColdStorage } from '../src/core/cold-storage.js'
import { encodeWithIntegrity } from '../src/utils/binary-codec.js'

function createNoisyPayload(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  let seed = 0x12345678

  for (let i = 0; i < size; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    bytes[i] = seed & 0xff
  }

  return bytes
}

async function waitForDiskQueueDrain(
  storage: MemoryColdStorage,
  maxIterations = 200,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (let i = 0; i < maxIterations; i++) {
    // Double-setImmediate: first tick allows pending I/O callbacks to fire;
    // second tick allows the resulting promise microtasks to settle.
    // This is a well-known Node.js pattern for waiting on real async I/O.
    await new Promise<void>((resolve) => setImmediate(() => setImmediate(resolve)))
    if (storage.diskQueueDepth === 0) return
    if (Date.now() >= deadline) break
  }
  if (storage.diskQueueDepth !== 0) {
    throw new Error('disk queue did not drain in time')
  }
}

describe('ColdStorage', () => {
  let storage: MemoryColdStorage

  beforeEach(() => {
    storage = new MemoryColdStorage()
  })

  describe('MemoryColdStorage', () => {
    it('should write and read payload', async () => {
      const payload = new TextEncoder().encode('Test evidence')
      const encoded = encodeWithIntegrity(payload)

      const writeResult = await storage.write('test-id', encoded)
      expect(writeResult.success).toBe(true)
      expect(writeResult.id).toBe('test-id')

      const readResult = await storage.read('test-id')
      expect(readResult.success).toBe(true)
      expect(readResult.payload).toEqual(encoded)
    })

    it('rejects empty id on write', async () => {
      const encoded = encodeWithIntegrity(new TextEncoder().encode('invalid-id'))
      const result = await storage.write('', encoded)

      expect(result.success).toBe(false)
      expect(result.error).toContain('non-empty string')
    })
    it('should return error for non-existent id', async () => {
      const readResult = await storage.read('non-existent')
      expect(readResult.success).toBe(false)
      expect(readResult.error).toBe('Not found')
    })

    it('should delete payload', async () => {
      const payload = new TextEncoder().encode('Delete me')
      const encoded = encodeWithIntegrity(payload)

      await storage.write('delete-id', encoded)
      expect(storage.size).toBe(1)

      const deleted = await storage.delete('delete-id')
      expect(deleted).toBe(true)
      expect(storage.size).toBe(0)
    })

    it('should report availability', async () => {
      expect(await storage.isAvailable()).toBe(true)
    })

    it('should clear all storage and reset drop counters', async () => {
      const bounded = new MemoryColdStorage({
        maxEntries: 1,
        maxBytes: 64,
      })
      const oversized = encodeWithIntegrity(createNoisyPayload(1024))

      await bounded.write('oversized', oversized)
      expect(bounded.droppedCount).toBe(1)
      expect(bounded.droppedBytes).toBeGreaterThan(0)

      bounded.clear()
      expect(bounded.size).toBe(0)
      expect(bounded.bytes).toBe(0)
      expect(bounded.droppedCount).toBe(0)
      expect(bounded.droppedBytes).toBe(0)
    })
  })

  describe('memory-first bounded buffering', () => {
    it('evicts oldest entries when maxEntries is exceeded', async () => {
      const bounded = new MemoryColdStorage({
        maxEntries: 2,
        maxBytes: 10_000,
      })

      const encoded = encodeWithIntegrity(new TextEncoder().encode('bounded-entry'))

      await bounded.write('id-1', encoded)
      await bounded.write('id-2', encoded)
      await bounded.write('id-3', encoded)

      expect(bounded.size).toBe(2)
      expect(bounded.droppedCount).toBe(1)
      expect((await bounded.read('id-1')).success).toBe(false)
      expect((await bounded.read('id-2')).success).toBe(true)
      expect((await bounded.read('id-3')).success).toBe(true)
    })

    it('evicts and counts when maxBytes is exceeded', async () => {
      const bounded = new MemoryColdStorage({
        maxEntries: 100,
        maxBytes: 300,
      })

      const first = encodeWithIntegrity(createNoisyPayload(96))
      const second = encodeWithIntegrity(createNoisyPayload(96))
      const third = encodeWithIntegrity(createNoisyPayload(96))

      await bounded.write('bytes-1', first)
      await bounded.write('bytes-2', second)
      await bounded.write('bytes-3', third)

      expect(bounded.bytes).toBeLessThanOrEqual(300)
      expect(bounded.droppedCount).toBeGreaterThan(0)
      expect(bounded.droppedBytes).toBeGreaterThan(0)
    })

    it('rejects oversized payload when disk buffer is disabled', async () => {
      const bounded = new MemoryColdStorage({
        maxEntries: 10,
        maxBytes: 64,
      })

      const oversized = encodeWithIntegrity(createNoisyPayload(1024))
      const result = await bounded.write('oversized', oversized)

      expect(result.success).toBe(false)
      expect(result.error).toContain('disk buffer is disabled')
      expect(bounded.size).toBe(0)
      expect(bounded.droppedCount).toBe(1)
    })
  })

  describe('disk buffering (explicit opt-in)', () => {
    it('spills oversized payload to disk when enabled and can be reloaded by new instance', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'tracehound-cold-disk-'))
      const path = join(dir, 'cold-buffer.ndjson')

      try {
        const diskBacked = new MemoryColdStorage({
          maxEntries: 4,
          maxBytes: 64,
          diskBuffer: {
            enabled: true,
            path,
          },
        })

        const oversized = encodeWithIntegrity(createNoisyPayload(1024))
        const writeResult = await diskBacked.write('disk-id', oversized)

        expect(writeResult.success).toBe(true)
        expect(diskBacked.size).toBe(0) // cannot fit memory cap

        await waitForDiskQueueDrain(diskBacked)

        const diskReader = new MemoryColdStorage({
          maxEntries: 4,
          maxBytes: 64,
          diskBuffer: {
            enabled: true,
            path,
          },
        })

        const readResult = await diskReader.read('disk-id')
        expect(readResult.success).toBe(true)
        expect(readResult.payload?.hash).toBe(oversized.hash)

        const deleted = await diskBacked.delete('disk-id')
        expect(deleted).toBe(true)

        await waitForDiskQueueDrain(diskBacked)

        const reloadedReader = new MemoryColdStorage({
          maxEntries: 4,
          maxBytes: 64,
          diskBuffer: {
            enabled: true,
            path,
          },
        })

        const afterDelete = await reloadedReader.read('disk-id')
        expect(afterDelete.success).toBe(false)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('handles malformed disk log lines while rebuilding index', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'tracehound-cold-disk-'))
      const path = join(dir, 'cold-buffer.ndjson')

      try {
        const diskBacked = new MemoryColdStorage({
          maxEntries: 0,
          maxBytes: 1,
          diskBuffer: {
            enabled: true,
            path,
          },
        })

        const encoded = encodeWithIntegrity(createNoisyPayload(256))
        await diskBacked.write('valid-id', encoded)
        await waitForDiskQueueDrain(diskBacked)

        appendFileSync(path, 'not-json\n', 'utf8')
        appendFileSync(path, '{"kind":"unknown","id":"x"}\n', 'utf8')

        const reader = new MemoryColdStorage({
          maxEntries: 1,
          maxBytes: 64,
          diskBuffer: {
            enabled: true,
            path,
          },
        })

        const result = await reader.read('valid-id')
        expect(result.success).toBe(true)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('returns not found when indexed file is removed before open', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'tracehound-cold-disk-'))
      const path = join(dir, 'cold-buffer.ndjson')

      try {
        const writer = new MemoryColdStorage({
          maxEntries: 0,
          maxBytes: 1,
          diskBuffer: {
            enabled: true,
            path,
          },
        })

        const encoded = encodeWithIntegrity(createNoisyPayload(256))
        await writer.write('race-id', encoded)
        await waitForDiskQueueDrain(writer)

        const reader = new MemoryColdStorage({
          maxEntries: 1,
          maxBytes: 64,
          diskBuffer: {
            enabled: true,
            path,
          },
        })

        const first = await reader.read('race-id')
        expect(first.success).toBe(true)

        rmSync(path, { force: true })

        const second = await reader.read('race-id')
        expect(second.success).toBe(false)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('reports queue overflow warning and counts dropped queue items', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'tracehound-cold-disk-'))
      const path = join(dir, 'cold-buffer.ndjson')

      try {
        const queueBounded = new MemoryColdStorage({
          maxEntries: 0,
          maxBytes: 1,
          diskBuffer: {
            enabled: true,
            path,
            maxQueueEntries: 1,
          },
        })

        const payload = encodeWithIntegrity(createNoisyPayload(256))

        const writes = [
          queueBounded.write('q-1', payload),
          queueBounded.write('q-2', payload),
          queueBounded.write('q-3', payload),
        ]

        const results = await Promise.all(writes)

        expect(results.some((result) => result.error?.includes('disk queue overflow'))).toBe(true)
        expect(queueBounded.diskQueueDroppedCount).toBeGreaterThan(0)

        await waitForDiskQueueDrain(queueBounded)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('returns explicit error when disk opt-in has no path', async () => {
      const invalid = new MemoryColdStorage({
        maxEntries: 0,
        maxBytes: 1,
        diskBuffer: {
          enabled: true,
        },
      })

      const payload = encodeWithIntegrity(createNoisyPayload(256))
      const writeResult = await invalid.write('no-path', payload)

      expect(writeResult.success).toBe(false)
      expect(writeResult.error).toContain('disk buffer path is required')
      expect(await invalid.isAvailable()).toBe(false)
    })

    it('returns pending put payload before async flush completes', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'tracehound-cold-disk-'))
      const path = join(dir, 'cold-buffer.ndjson')

      try {
        const diskBacked = new MemoryColdStorage({
          maxEntries: 0,
          maxBytes: 1,
          diskBuffer: {
            enabled: true,
            path,
          },
        })

        const oversized = encodeWithIntegrity(createNoisyPayload(512))
        const writePromise = diskBacked.write('pending-put-id', oversized)
        const readResult = await diskBacked.read('pending-put-id')
        await writePromise

        expect(readResult.success).toBe(true)
        expect(readResult.payload?.hash).toBe(oversized.hash)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('returns not found when latest pending event is delete', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'tracehound-cold-disk-'))
      const path = join(dir, 'cold-buffer.ndjson')

      try {
        const diskBacked = new MemoryColdStorage({
          maxEntries: 0,
          maxBytes: 1,
          diskBuffer: {
            enabled: true,
            path,
          },
        })

        const oversized = encodeWithIntegrity(createNoisyPayload(512))
        await diskBacked.write('pending-delete-id', oversized)
        const deleted = await diskBacked.delete('pending-delete-id')
        const readResult = await diskBacked.read('pending-delete-id')

        expect(deleted).toBe(true)
        expect(readResult.success).toBe(false)
        expect(readResult.error).toBe('Not found')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('falls back to memory delete result when disk enqueue is rejected', async () => {
      const memoryFirst = new MemoryColdStorage({
        maxEntries: 2,
        maxBytes: 1024,
        diskBuffer: {
          enabled: true,
        },
      })

      const payload = encodeWithIntegrity(new TextEncoder().encode('memory-delete'))
      const writeResult = await memoryFirst.write('memory-delete-id', payload)
      const deleted = await memoryFirst.delete('memory-delete-id')

      expect(writeResult.success).toBe(true)
      expect(writeResult.error).toContain('disk buffer path is required')
      expect(deleted).toBe(true)
      expect((await memoryFirst.read('memory-delete-id')).success).toBe(false)
    })

    it('clear resets disk queue counters', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'tracehound-cold-disk-'))
      const path = join(dir, 'cold-buffer.ndjson')

      try {
        const queueBounded = new MemoryColdStorage({
          maxEntries: 0,
          maxBytes: 1,
          diskBuffer: {
            enabled: true,
            path,
            maxQueueEntries: 1,
          },
        })

        const payload = encodeWithIntegrity(createNoisyPayload(256))
        await Promise.all([
          queueBounded.write('drop-1', payload),
          queueBounded.write('drop-2', payload),
          queueBounded.write('drop-3', payload),
        ])

        expect(queueBounded.diskQueueDroppedCount).toBeGreaterThan(0)

        queueBounded.clear()

        expect(queueBounded.diskQueueDepth).toBe(0)
        expect(queueBounded.diskQueueDroppedCount).toBe(0)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe('createMemoryColdStorage', () => {
    it('should create adapter instance', () => {
      const adapter = createMemoryColdStorage()
      expect(adapter).toBeDefined()
      expect(typeof adapter.write).toBe('function')
      expect(typeof adapter.read).toBe('function')
      expect(typeof adapter.delete).toBe('function')
    })

    it('accepts bounded options', async () => {
      const adapter = createMemoryColdStorage({
        maxEntries: 1,
        maxBytes: 100,
      })

      const encoded = encodeWithIntegrity(new TextEncoder().encode('bounded-factory'))
      await adapter.write('factory-1', encoded)
      await adapter.write('factory-2', encoded)

      const first = await adapter.read('factory-1')
      expect(first.success).toBe(false)
    })
  })
})
