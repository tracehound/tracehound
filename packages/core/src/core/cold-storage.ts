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
import {
  createReadStream,
  existsSync,
  openSync,
  readSync,
  closeSync,
  statSync,
  truncateSync,
} from 'node:fs'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import type { EncodedPayload } from '../utils/binary-codec.js'

const DEFAULT_MAX_ENTRIES = 1_024
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_DISK_QUEUE_ENTRIES = 1_024
const DISK_FLUSH_BATCH_SIZE = 128
const DISK_FLUSH_RETRY_MS = 1_000

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
  /** Bounded in-memory queue length for async disk flush */
  maxQueueEntries?: number
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

interface DiskQueueItem {
  event: DiskEvent
  line: string
  bytes: number
}

interface DiskIndexEntry {
  kind: DiskEvent['kind']
  offset: number
  length: number
}

interface EnqueueResult {
  accepted: boolean
  warning?: string
  error?: string
}

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
  private readonly maxDiskQueueEntries: number

  private totalBytes = 0
  private totalDropped = 0
  private totalDroppedBytes = 0

  private readonly diskQueue: DiskQueueItem[] = []
  private diskQueueDropped = 0
  private diskFlushing = false

  private diskNextOffset: number | null = null
  private readonly diskIndex = new Map<string, DiskIndexEntry>()
  private diskIndexLoaded = false
  private diskIndexLoading: Promise<void> | null = null

  constructor(options: MemoryColdStorageOptions = {}) {
    this.maxEntries = coerceNonNegativeInt(options.maxEntries, DEFAULT_MAX_ENTRIES)
    this.maxBytes = coerceNonNegativeInt(options.maxBytes, DEFAULT_MAX_BYTES)
    this.diskBufferEnabled = options.diskBuffer?.enabled === true
    this.diskBufferPath = options.diskBuffer?.path
    this.maxDiskQueueEntries = coercePositiveInt(
      options.diskBuffer?.maxQueueEntries,
      DEFAULT_MAX_DISK_QUEUE_ENTRIES,
    )

    if (this.diskBufferEnabled && this.diskBufferPath) {
      this.diskNextOffset = safeFileSize(this.diskBufferPath)
    }
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

      const enqueued = this.enqueueDiskEvent({
        kind: 'put',
        id,
        at: Date.now(),
        payload: serializePayload(payload),
      })

      if (!enqueued.accepted) {
        return {
          success: false,
          error: enqueued.error ?? 'disk buffer enqueue failed',
        }
      }

      if (enqueued.warning) {
        return { success: true, id, error: enqueued.warning }
      }

      return { success: true, id }
    }

    this.upsertMemory(id, payload, estimatedBytes)
    this.enforceBounds()

    if (!this.diskBufferEnabled) {
      return { success: true, id }
    }

    const enqueued = this.enqueueDiskEvent({
      kind: 'put',
      id,
      at: Date.now(),
      payload: serializePayload(payload),
    })

    if (!enqueued.accepted) {
      return {
        success: true,
        id,
        error: enqueued.error ?? 'disk buffer enqueue failed',
      }
    }

    if (enqueued.warning) {
      return { success: true, id, error: enqueued.warning }
    }

    return { success: true, id }
  }

  async read(id: string): Promise<ColdStorageReadResult> {
    const memoryPayload = this.storage.get(id)
    if (memoryPayload) {
      return { success: true, payload: memoryPayload }
    }

    if (!this.diskBufferEnabled) {
      return { success: false, error: 'Not found' }
    }

    const pending = this.findPendingDiskEvent(id)
    if (pending) {
      if (pending.kind === 'delete') {
        return { success: false, error: 'Not found' }
      }

      return { success: true, payload: deserializePayload(pending.payload) }
    }

    try {
      const entry = await this.getDiskIndexEntry(id)
      if (!entry || entry.kind === 'delete') {
        return { success: false, error: 'Not found' }
      }

      const payload = this.readDiskPayloadAt(entry)
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

    const enqueued = this.enqueueDiskEvent({
      kind: 'delete',
      id,
      at: Date.now(),
    })

    if (!enqueued.accepted) {
      return removed
    }

    return true
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

  /** Current disk flush queue depth (testing helper) */
  get diskQueueDepth(): number {
    return this.diskQueue.length
  }

  /** Total dropped disk queue events (testing helper) */
  get diskQueueDroppedCount(): number {
    return this.diskQueueDropped
  }

  /** Clear all storage (testing helper) */
  clear(): void {
    this.storage.clear()
    this.payloadSizes.clear()
    this.totalBytes = 0
    this.totalDropped = 0
    this.totalDroppedBytes = 0

    this.diskQueue.length = 0
    this.diskQueueDropped = 0
    this.diskIndex.clear()
    this.diskIndexLoaded = false
    this.diskIndexLoading = null

    if (this.diskBufferEnabled && this.diskBufferPath && existsSync(this.diskBufferPath)) {
      try {
        truncateSync(this.diskBufferPath, 0)
      } catch {
        // ignore
      }
    }

    if (this.diskBufferEnabled && this.diskBufferPath) {
      this.diskNextOffset = safeFileSize(this.diskBufferPath)
    } else {
      this.diskNextOffset = 0
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

  private enqueueDiskEvent(event: DiskEvent): EnqueueResult {
    if (!this.diskBufferEnabled) {
      return {
        accepted: false,
        error: 'disk buffering is disabled',
      }
    }

    if (!this.diskBufferPath || this.diskBufferPath.length === 0) {
      return {
        accepted: false,
        error: 'disk buffer path is required when disk buffering is enabled',
      }
    }

    const line = `${JSON.stringify(event)}\n`
    const item: DiskQueueItem = {
      event,
      line,
      bytes: Buffer.byteLength(line),
    }

    let queueDropped = false
    while (this.diskQueue.length >= this.maxDiskQueueEntries) {
      this.diskQueue.shift()
      this.diskQueueDropped++
      queueDropped = true
    }

    this.diskQueue.push(item)
    this.scheduleDiskFlush()

    if (queueDropped) {
      return {
        accepted: true,
        warning: 'disk queue overflow: oldest pending event dropped',
      }
    }

    return { accepted: true }
  }

  private scheduleDiskFlush(delayMs: number = 0): void {
    if (this.diskFlushing || this.diskQueue.length === 0) {
      return
    }

    this.diskFlushing = true

    const run = () => {
      void this.flushDiskQueue()
    }

    if (delayMs > 0) {
      setTimeout(run, delayMs)
      return
    }

    queueMicrotask(run)
  }

  private async flushDiskQueue(): Promise<void> {
    const path = this.diskBufferPath

    if (!path || path.length === 0) {
      this.diskFlushing = false
      return
    }

    let flushFailed = false

    try {
      await mkdir(dirname(path), { recursive: true })

      while (this.diskQueue.length > 0) {
        const batch = this.diskQueue.slice(0, Math.min(DISK_FLUSH_BATCH_SIZE, this.diskQueue.length))
        if (batch.length === 0) {
          break
        }

        const payload = batch.map((item) => item.line).join('')
        const startOffset = this.resolveDiskNextOffset(path)

        try {
          await appendFile(path, payload, 'utf8')
        } catch {
          flushFailed = true
          break
        }

        this.diskQueue.splice(0, batch.length)

        let offset = startOffset
        for (const item of batch) {
          this.diskIndex.set(item.event.id, {
            kind: item.event.kind,
            offset,
            length: item.bytes,
          })
          offset += item.bytes
        }

        this.diskNextOffset = offset
      }
    } catch {
      flushFailed = true
    } finally {
      this.diskFlushing = false

      if (this.diskQueue.length > 0) {
        this.scheduleDiskFlush(flushFailed ? DISK_FLUSH_RETRY_MS : 0)
      }
    }
  }

  private resolveDiskNextOffset(path: string): number {
    if (typeof this.diskNextOffset === 'number' && this.diskNextOffset >= 0) {
      return this.diskNextOffset
    }

    this.diskNextOffset = safeFileSize(path)
    return this.diskNextOffset
  }

  private findPendingDiskEvent(id: string): DiskEvent | null {
    for (let i = this.diskQueue.length - 1; i >= 0; i--) {
      const event = this.diskQueue[i]?.event
      if (!event) {
        continue
      }

      if (event.id === id) {
        return event
      }
    }

    return null
  }

  private async getDiskIndexEntry(id: string): Promise<DiskIndexEntry | undefined> {
    await this.ensureDiskIndexLoaded()
    return this.diskIndex.get(id)
  }

  private async ensureDiskIndexLoaded(): Promise<void> {
    if (this.diskIndexLoaded) {
      return
    }

    if (this.diskIndexLoading) {
      await this.diskIndexLoading
      return
    }

    this.diskIndexLoading = this.rebuildDiskIndex()

    try {
      await this.diskIndexLoading
      this.diskIndexLoaded = true
    } finally {
      this.diskIndexLoading = null
    }
  }

  private async rebuildDiskIndex(): Promise<void> {
    this.diskIndex.clear()

    const path = this.diskBufferPath
    if (!path || path.length === 0 || !existsSync(path)) {
      this.diskNextOffset = 0
      return
    }

    const stream = createReadStream(path, { encoding: 'utf8' })
    const reader = createInterface({ input: stream, crlfDelay: Infinity })

    let offset = 0

    try {
      for await (const line of reader) {
        const lineWithNewline = `${line}\n`
        const bytes = Buffer.byteLength(lineWithNewline)

        if (line.length > 0) {
          const event = parseDiskEvent(line)
          if (event) {
            this.diskIndex.set(event.id, {
              kind: event.kind,
              offset,
              length: bytes,
            })
          }
        }

        offset += bytes
      }
    } finally {
      try {
        reader.close()
      } catch {
        // ignore close errors
      }

      try {
        stream.close()
      } catch {
        // ignore close errors
      }
    }

    this.diskNextOffset = offset
  }

  private readDiskPayloadAt(entry: DiskIndexEntry): EncodedPayload | null {
    const path = this.diskBufferPath
    if (!path || path.length === 0) {
      return null
    }

    let fd: number
    try {
      fd = openSync(path, 'r')
    } catch {
      // File may be rotated/deleted between index lookup and open.
      return null
    }

    try {
      const buffer = Buffer.alloc(entry.length)
      const bytesRead = readSync(fd, buffer, 0, entry.length, entry.offset)
      if (bytesRead <= 0) {
        return null
      }

      const line = buffer.subarray(0, bytesRead).toString('utf8').trim()
      if (line.length === 0) {
        return null
      }

      const event = parseDiskEvent(line)
      if (!event || event.kind !== 'put') {
        return null
      }

      return deserializePayload(event.payload)
    } catch {
      return null
    } finally {
      try {
        closeSync(fd)
      } catch {
        // ignore close errors
      }
    }
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

function coercePositiveInt(input: number | undefined, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
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

function parseDiskEvent(line: string): DiskEvent | null {
  try {
    const parsed = JSON.parse(line) as Partial<DiskEvent>

    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    if (parsed.kind === 'put') {
      const candidate = parsed as Partial<DiskPutEvent>
      if (
        typeof candidate.id === 'string' &&
        candidate.id.length > 0 &&
        candidate.payload !== undefined &&
        isSerializedPayload(candidate.payload)
      ) {
        return {
          kind: 'put',
          id: candidate.id,
          at: typeof candidate.at === 'number' ? candidate.at : Date.now(),
          payload: candidate.payload,
        }
      }

      return null
    }

    if (parsed.kind === 'delete') {
      const candidate = parsed as Partial<DiskDeleteEvent>
      if (typeof candidate.id === 'string' && candidate.id.length > 0) {
        return {
          kind: 'delete',
          id: candidate.id,
          at: typeof candidate.at === 'number' ? candidate.at : Date.now(),
        }
      }

      return null
    }

    return null
  } catch {
    return null
  }
}

function isSerializedPayload(value: unknown): value is DiskPutEvent['payload'] {
  if (!value || typeof value !== 'object') {
    return false
  }

  const payload = value as Partial<DiskPutEvent['payload']>

  return (
    typeof payload.compressedBase64 === 'string' &&
    typeof payload.hash === 'string' &&
    typeof payload.originalSize === 'number' &&
    Number.isFinite(payload.originalSize) &&
    payload.originalSize >= 0 &&
    typeof payload.compressedSize === 'number' &&
    Number.isFinite(payload.compressedSize) &&
    payload.compressedSize >= 0
  )
}

function safeFileSize(path: string): number {
  if (!existsSync(path)) {
    return 0
  }

  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

