/**
 * Cold Storage Adapter
 *
 * Fire-and-forget interface for archiving evidence to external storage.
 * Used by Quarantine.evacuate() for long-term forensic storage.
 *
 * RFC-0000 INVARIANTS:
 * - write() is fire-and-forget (no blocking hot-path)
 * - Adapter errors are logged, not thrown
 * - Payload must be encoded with encodeWithIntegrity() before write
 *
 * RFC-0011 DEFAULTS:
 * - Memory-first bounded buffering is the default
 * - Disk buffering remains explicit opt-in
 */

import { Buffer } from 'node:buffer'
import { existsSync, truncateSync } from 'node:fs'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { EncodedPayload } from '../utils/binary-codec.js'

const DEFAULT_MAX_ENTRIES = 1_024
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024

/**
 * Cold storage write result.
 */
export interface ColdStorageWriteResult {
  /** Whether write succeeded */
  success: boolean
  /** Storage-specific ID (e.g., S3 key, URL) */
  id?: string
  /** Error message if failed */
  error?: string
}

/**
 * Cold storage read result.
 */
export interface ColdStorageReadResult {
  /** Whether read succeeded */
  success: boolean
  /** Encoded payload if found */
  payload?: EncodedPayload
  /** Error message if failed */
  error?: string
}

/**
 * Optional disk buffer settings.
 * Disabled by default.
 */
export interface DiskBufferOptions {
  /** Explicit opt-in flag */
  enabled?: boolean
  /** NDJSON path for optional disk buffering */
  path?: string
}

/**
 * Memory cold storage options.
 */
export interface MemoryColdStorageOptions {
  /** Maximum entries kept in memory ring buffer */
  maxEntries?: number
  /** Maximum estimated bytes kept in memory ring buffer */
  maxBytes?: number
  /** Optional disk buffer (explicit opt-in) */
  diskBuffer?: DiskBufferOptions
}

/**
 * Cold Storage Adapter interface.
 *
 * Implementations: MemoryColdStorage (testing), S3Adapter, R2Adapter, etc.
 */
export interface IColdStorageAdapter {
  /**
   * Write encoded evidence to cold storage.
   * Fire-and-forget semantics - caller does not wait.
   *
   * @param id - Unique evidence ID (signature)
   * @param payload - Encoded and hashed payload
   */
  write(id: string, payload: EncodedPayload): Promise<ColdStorageWriteResult>

  /**
   * Read evidence from cold storage.
   * Used for forensics/evacuation only.
   *
   * @param id - Evidence ID to retrieve
   */
  read(id: string): Promise<ColdStorageReadResult>

  /**
   * Delete evidence from cold storage.
   * Used for policy-based cleanup.
   *
   * @param id - Evidence ID to delete
   */
  delete(id: string): Promise<boolean>

  /**
   * Check if storage is available.
   */
  isAvailable(): Promise<boolean>
}

interface DiskPutEvent {
  kind: 'put'
  id: string
  at: number
  payload: {
    compressedBase64: string
    hash: string
    originalSize: number
    compressedSize: number
  }
}

interface DiskDeleteEvent {
  kind: 'delete'
  id: string
  at: number
}

type DiskEvent = DiskPutEvent | DiskDeleteEvent

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Implementation (Memory-first + optional disk)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Memory-first cold storage with bounded ring buffer semantics.
 * Disk buffering is explicit opt-in.
 */
export class MemoryColdStorage implements IColdStorageAdapter {
  private readonly storage = new Map<string, EncodedPayload>()
  private readonly payloadSizes = new Map<string, number>()
  private readonly maxEntries: number
  private readonly maxBytes: number
  private readonly diskBufferEnabled: boolean
  private readonly diskBufferPath: string | undefined

  private totalBytes = 0
  private totalDropped = 0
  private totalDroppedBytes = 0

  constructor(options: MemoryColdStorageOptions = {}) {
    this.maxEntries = coerceNonNegativeInt(options.maxEntries, DEFAULT_MAX_ENTRIES)
    this.maxBytes = coerceNonNegativeInt(options.maxBytes, DEFAULT_MAX_BYTES)
    this.diskBufferEnabled = options.diskBuffer?.enabled === true
    this.diskBufferPath = options.diskBuffer?.path
  }

  async write(id: string, payload: EncodedPayload): Promise<ColdStorageWriteResult> {
    if (typeof id !== 'string' || id.length === 0) {
      return { success: false, error: 'id must be a non-empty string' }
    }

    const estimatedBytes = estimatePayloadBytes(payload)

    // If payload cannot fit memory bounds, disk buffer must be explicitly enabled.
    if (estimatedBytes > this.maxBytes || this.maxBytes === 0 || this.maxEntries === 0) {
      this.totalDropped++
      this.totalDroppedBytes += estimatedBytes

      if (!this.diskBufferEnabled) {
        return {
          success: false,
          error: 'payload exceeds memory buffer limit and disk buffer is disabled',
        }
      }

      try {
        await this.appendDiskEvent({
          kind: 'put',
          id,
          at: Date.now(),
          payload: serializePayload(payload),
        })
        return { success: true, id }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'disk buffer write failed',
        }
      }
    }

    this.upsertMemory(id, payload, estimatedBytes)
    this.enforceBounds()

    if (!this.diskBufferEnabled) {
      return { success: true, id }
    }

    try {
      await this.appendDiskEvent({
        kind: 'put',
        id,
        at: Date.now(),
        payload: serializePayload(payload),
      })
      return { success: true, id }
    } catch (error: unknown) {
      // Memory write succeeded; disk mirror is best-effort.
      return {
        success: true,
        id,
        error: error instanceof Error ? error.message : 'disk buffer write failed',
      }
    }
  }

  async read(id: string): Promise<ColdStorageReadResult> {
    const memoryPayload = this.storage.get(id)
    if (memoryPayload) {
      return { success: true, payload: memoryPayload }
    }

    if (!this.diskBufferEnabled) {
      return { success: false, error: 'Not found' }
    }

    try {
      const payload = await this.readFromDisk(id)
      if (!payload) {
        return { success: false, error: 'Not found' }
      }
      return { success: true, payload }
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'disk buffer read failed',
      }
    }
  }

  async delete(id: string): Promise<boolean> {
    const removed = this.removeFromMemory(id)

    if (!this.diskBufferEnabled) {
      return removed
    }

    try {
      await this.appendDiskEvent({
        kind: 'delete',
        id,
        at: Date.now(),
      })
      return true
    } catch {
      return removed
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!this.diskBufferEnabled) {
      return true
    }

    if (!this.diskBufferPath || this.diskBufferPath.length === 0) {
      return false
    }

    try {
      await mkdir(dirname(this.diskBufferPath), { recursive: true })
      await appendFile(this.diskBufferPath, '', 'utf8')
      return true
    } catch {
      return false
    }
  }

  /** Get in-memory storage size (testing helper) */
  get size(): number {
    return this.storage.size
  }

  /** Get in-memory byte usage (testing helper) */
  get bytes(): number {
    return this.totalBytes
  }

  /** Total dropped events due to memory bounds (testing helper) */
  get droppedCount(): number {
    return this.totalDropped
  }

  /** Total dropped estimated bytes due to memory bounds (testing helper) */
  get droppedBytes(): number {
    return this.totalDroppedBytes
  }

  /** Clear all storage (testing helper) */
  clear(): void {
    this.storage.clear()
    this.payloadSizes.clear()
    this.totalBytes = 0

    if (this.diskBufferEnabled && this.diskBufferPath && existsSync(this.diskBufferPath)) {
      try {
        truncateSync(this.diskBufferPath, 0)
      } catch {
        // ignore
      }
    }
  }

  private upsertMemory(id: string, payload: EncodedPayload, estimatedBytes: number): void {
    const existingSize = this.payloadSizes.get(id)
    if (typeof existingSize === 'number') {
      this.totalBytes -= existingSize
      this.storage.delete(id)
      this.payloadSizes.delete(id)
    }

    this.storage.set(id, payload)
    this.payloadSizes.set(id, estimatedBytes)
    this.totalBytes += estimatedBytes
  }

  private enforceBounds(): void {
    while (this.storage.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldestId = this.storage.keys().next().value as string | undefined
      if (!oldestId) {
        break
      }

      const removedSize = this.payloadSizes.get(oldestId) ?? 0

      this.storage.delete(oldestId)
      this.payloadSizes.delete(oldestId)
      this.totalBytes -= removedSize
      this.totalDropped++
      this.totalDroppedBytes += removedSize
    }
  }

  private removeFromMemory(id: string): boolean {
    const existingSize = this.payloadSizes.get(id)
    const removed = this.storage.delete(id)

    if (removed && typeof existingSize === 'number') {
      this.payloadSizes.delete(id)
      this.totalBytes -= existingSize
    }

    return removed
  }

  private async appendDiskEvent(event: DiskEvent): Promise<void> {
    if (!this.diskBufferEnabled) {
      return
    }

    if (!this.diskBufferPath || this.diskBufferPath.length === 0) {
      throw new Error('disk buffer path is required when disk buffering is enabled')
    }

    await mkdir(dirname(this.diskBufferPath), { recursive: true })
    await appendFile(this.diskBufferPath, `${JSON.stringify(event)}\n`, 'utf8')
  }

  private async readFromDisk(id: string): Promise<EncodedPayload | null> {
    if (!this.diskBufferPath || this.diskBufferPath.length === 0 || !existsSync(this.diskBufferPath)) {
      return null
    }

    const raw = await readFile(this.diskBufferPath, 'utf8')
    if (raw.length === 0) {
      return null
    }

    const lines = raw.split(/\r?\n/)

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]
      if (!line || line.length === 0) {
        continue
      }

      let parsed: DiskEvent | null = null
      try {
        parsed = JSON.parse(line) as DiskEvent
      } catch {
        continue
      }

      if (!parsed || parsed.id !== id) {
        continue
      }

      if (parsed.kind === 'delete') {
        return null
      }

      if (parsed.kind !== 'put') {
        continue
      }

      return deserializePayload(parsed.payload)
    }

    return null
  }
}

/**
 * Create an in-memory cold storage adapter for testing.
 */
export function createMemoryColdStorage(options?: MemoryColdStorageOptions): IColdStorageAdapter {
  return new MemoryColdStorage(options)
}

function coerceNonNegativeInt(input: number | undefined, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    return fallback
  }

  if (input < 0) {
    return fallback
  }

  return Math.floor(input)
}

function estimatePayloadBytes(payload: EncodedPayload): number {
  // Compressed bytes are the dominant memory component. The extra metadata is tiny but
  // still accounted for to keep byte cap behavior deterministic.
  return payload.compressed.byteLength + payload.hash.length + 16
}

function serializePayload(payload: EncodedPayload): DiskPutEvent['payload'] {
  return {
    compressedBase64: Buffer.from(payload.compressed).toString('base64'),
    hash: payload.hash,
    originalSize: payload.originalSize,
    compressedSize: payload.compressedSize,
  }
}

function deserializePayload(serialized: DiskPutEvent['payload']): EncodedPayload {
  const compressed = new Uint8Array(Buffer.from(serialized.compressedBase64, 'base64'))

  return {
    compressed,
    hash: serialized.hash,
    originalSize: serialized.originalSize,
    compressedSize: serialized.compressedSize,
  }
}

