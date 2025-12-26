/**
 * Cold Storage Adapter tests.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryColdStorage, createMemoryColdStorage } from '../src/core/cold-storage.js'
import { encodeWithIntegrity } from '../src/utils/binary-codec.js'

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
  })
})
