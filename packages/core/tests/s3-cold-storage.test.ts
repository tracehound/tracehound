/**
 * S3 Cold Storage Adapter tests.
 *
 * Uses a mock S3LikeClient — no real S3 calls.
 * Tests: write/read/delete, envelope integrity, error handling.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { S3LikeClient } from '../src/core/s3-cold-storage.js'
import { createS3ColdStorage, S3ColdStorage } from '../src/core/s3-cold-storage.js'
import { encodeWithIntegrity, verify } from '../src/utils/binary-codec.js'

/**
 * Create an in-memory mock S3 client for testing.
 */
function createMockS3Client(): S3LikeClient & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>()

  return {
    objects,

    async putObject(params) {
      objects.set(`${params.Bucket}/${params.Key}`, new Uint8Array(params.Body))
    },

    async getObject(params) {
      const data = objects.get(`${params.Bucket}/${params.Key}`)
      if (!data) {
        throw new Error('NoSuchKey: The specified key does not exist.')
      }
      return { Body: data }
    },

    async deleteObject(params) {
      objects.delete(`${params.Bucket}/${params.Key}`)
    },

    async headBucket(_params) {
      // Always available in mock
    },
  }
}

describe('S3ColdStorage', () => {
  let mockClient: ReturnType<typeof createMockS3Client>
  let storage: S3ColdStorage

  beforeEach(() => {
    mockClient = createMockS3Client()
    storage = new S3ColdStorage({
      client: mockClient,
      bucket: 'test-bucket',
      prefix: 'evidence/',
    })
  })

  describe('write + read round-trip', () => {
    it('should write and read back identical payload', async () => {
      const payload = new TextEncoder().encode('SQL injection evidence')
      const encoded = encodeWithIntegrity(payload)

      const writeResult = await storage.write('ev-001', encoded)
      expect(writeResult.success).toBe(true)
      expect(writeResult.id).toBe('evidence/ev-001.thcs')

      const readResult = await storage.read('ev-001')
      expect(readResult.success).toBe(true)
      expect(readResult.payload).toBeDefined()

      // Verify round-trip integrity
      expect(readResult.payload!.hash).toBe(encoded.hash)
      expect(readResult.payload!.originalSize).toBe(encoded.originalSize)
      expect(readResult.payload!.compressedSize).toBe(encoded.compressedSize)
      expect(readResult.payload!.compressed).toEqual(encoded.compressed)
    })

    it('should preserve integrity through envelope (verify() passes)', async () => {
      const payload = new TextEncoder().encode('XSS evidence payload')
      const encoded = encodeWithIntegrity(payload)

      await storage.write('ev-002', encoded)
      const readResult = await storage.read('ev-002')

      expect(readResult.success).toBe(true)
      expect(verify(readResult.payload!)).toBe(true)
    })

    it('should handle empty payload', async () => {
      const empty = new Uint8Array(0)
      const encoded = encodeWithIntegrity(empty)

      await storage.write('ev-empty', encoded)
      const readResult = await storage.read('ev-empty')

      expect(readResult.success).toBe(true)
      expect(readResult.payload!.originalSize).toBe(0)
      expect(verify(readResult.payload!)).toBe(true)
    })

    it('should handle large payload', async () => {
      const large = new TextEncoder().encode('X'.repeat(100_000))
      const encoded = encodeWithIntegrity(large)

      await storage.write('ev-large', encoded)
      const readResult = await storage.read('ev-large')

      expect(readResult.success).toBe(true)
      expect(readResult.payload!.originalSize).toBe(100_000)
      expect(readResult.payload!.compressed).toEqual(encoded.compressed)
    })
  })

  describe('read errors', () => {
    it('should return error for non-existent key', async () => {
      const readResult = await storage.read('non-existent')

      expect(readResult.success).toBe(false)
      expect(readResult.error).toContain('NoSuchKey')
    })

    it('should return error for corrupted envelope', async () => {
      // Write garbage directly to mock storage
      mockClient.objects.set('test-bucket/evidence/corrupt.thcs', new Uint8Array([0, 1, 2, 3]))

      const readResult = await storage.read('corrupt')

      expect(readResult.success).toBe(false)
      expect(readResult.error).toBe('Invalid envelope format')
    })
  })

  describe('delete', () => {
    it('should delete existing evidence', async () => {
      const encoded = encodeWithIntegrity(new TextEncoder().encode('delete me'))
      await storage.write('ev-del', encoded)

      const deleted = await storage.delete('ev-del')
      expect(deleted).toBe(true)

      const readResult = await storage.read('ev-del')
      expect(readResult.success).toBe(false)
    })

    it('should return false on delete error', async () => {
      // Create a client that throws on delete
      const failClient: S3LikeClient = {
        ...createMockS3Client(),
        async deleteObject() {
          throw new Error('AccessDenied')
        },
      }
      const failStorage = new S3ColdStorage({
        client: failClient,
        bucket: 'test',
      })

      const deleted = await failStorage.delete('any-id')
      expect(deleted).toBe(false)
    })
  })

  describe('isAvailable', () => {
    it('should return true when bucket is accessible', async () => {
      expect(await storage.isAvailable()).toBe(true)
    })

    it('should return false when bucket is inaccessible', async () => {
      const failClient: S3LikeClient = {
        ...createMockS3Client(),
        async headBucket() {
          throw new Error('NoSuchBucket')
        },
      }
      const failStorage = new S3ColdStorage({
        client: failClient,
        bucket: 'nonexistent',
      })

      expect(await failStorage.isAvailable()).toBe(false)
    })
  })

  describe('key prefix', () => {
    it('should use default prefix when not specified', async () => {
      const defaultStorage = new S3ColdStorage({
        client: mockClient,
        bucket: 'test-bucket',
      })

      const encoded = encodeWithIntegrity(new TextEncoder().encode('data'))
      const result = await defaultStorage.write('test-id', encoded)

      expect(result.id).toBe('tracehound/evidence/test-id.thcs')
    })

    it('should use custom prefix', async () => {
      const customStorage = new S3ColdStorage({
        client: mockClient,
        bucket: 'test-bucket',
        prefix: 'custom/path/',
      })

      const encoded = encodeWithIntegrity(new TextEncoder().encode('data'))
      const result = await customStorage.write('test-id', encoded)

      expect(result.id).toBe('custom/path/test-id.thcs')
    })
  })

  describe('write errors', () => {
    it('should return error result on write failure', async () => {
      const failClient: S3LikeClient = {
        ...createMockS3Client(),
        async putObject() {
          throw new Error('ServiceUnavailable')
        },
      }
      const failStorage = new S3ColdStorage({
        client: failClient,
        bucket: 'test',
      })

      const encoded = encodeWithIntegrity(new TextEncoder().encode('data'))
      const result = await failStorage.write('fail-id', encoded)

      expect(result.success).toBe(false)
      expect(result.error).toContain('ServiceUnavailable')
    })
  })

  describe('createS3ColdStorage factory', () => {
    it('should create adapter instance', () => {
      const adapter = createS3ColdStorage({
        client: mockClient,
        bucket: 'factory-bucket',
      })

      expect(adapter).toBeDefined()
      expect(typeof adapter.write).toBe('function')
      expect(typeof adapter.read).toBe('function')
      expect(typeof adapter.delete).toBe('function')
      expect(typeof adapter.isAvailable).toBe('function')
    })
  })
})
