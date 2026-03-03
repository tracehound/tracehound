/**
 * Cold Storage Adapter tests.
 */

import { mkdtempSync, rmSync } from 'node:fs'
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

    it('should clear all storage', async () => {
      const payload = new TextEncoder().encode('Data')
      const encoded = encodeWithIntegrity(payload)

      await storage.write('id-1', encoded)
      await storage.write('id-2', encoded)
      expect(storage.size).toBe(2)

      storage.clear()
      expect(storage.size).toBe(0)
      expect(storage.bytes).toBe(0)
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
    it('spills oversized payload to disk when enabled', async () => {
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

        const readResult = await diskBacked.read('disk-id')
        expect(readResult.success).toBe(true)
        expect(readResult.payload?.hash).toBe(oversized.hash)

        const deleted = await diskBacked.delete('disk-id')
        expect(deleted).toBe(true)

        const afterDelete = await diskBacked.read('disk-id')
        expect(afterDelete.success).toBe(false)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('reports unavailable when disk opt-in has no path', async () => {
      const invalid = new MemoryColdStorage({
        diskBuffer: {
          enabled: true,
        },
      })

      expect(await invalid.isAvailable()).toBe(false)
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
