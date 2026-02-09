/**
 * S3-Compatible Cold Storage Adapter
 *
 * Implements IColdStorageAdapter for any S3-compatible object store:
 * AWS S3, Cloudflare R2, Google Cloud Storage (S3-compat), MinIO, etc.
 *
 * DESIGN:
 * - Zero AWS SDK dependency. Client is injected via S3LikeClient interface.
 * - Binary envelope format: self-contained, no sidecar files needed.
 * - Async encode/decode via Phase 4 Async Codec.
 *
 * RFC-0000 INVARIANTS:
 * - write() is fire-and-forget (caller does not wait for confirmation)
 * - Adapter errors are caught and returned, never thrown
 * - Payload integrity is preserved via binary envelope with embedded hash
 */

import type { EncodedPayload } from '../utils/binary-codec.js'
import type { ColdStorageReadResult, ColdStorageWriteResult, IColdStorageAdapter } from './cold-storage.js'

// ─────────────────────────────────────────────────────────────────────────────
// S3-Like Client Interface (Dependency Injection)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal S3-compatible client interface.
 *
 * Users provide their own implementation using @aws-sdk/client-s3,
 * Cloudflare R2 bindings, MinIO client, or any S3-compatible SDK.
 *
 * @example
 * // AWS S3
 * import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3'
 * const s3 = new S3Client({ region: 'us-east-1' })
 * const client: S3LikeClient = {
 *   putObject: (p) => s3.send(new PutObjectCommand(p)).then(() => {}),
 *   getObject: (p) => s3.send(new GetObjectCommand(p)).then(r => ({
 *     Body: new Uint8Array(await r.Body!.transformToByteArray())
 *   })),
 *   deleteObject: (p) => s3.send(new DeleteObjectCommand(p)).then(() => {}),
 *   headBucket: (p) => s3.send(new HeadBucketCommand(p)).then(() => {}),
 * }
 */
export interface S3LikeClient {
  putObject(params: {
    Bucket: string
    Key: string
    Body: Uint8Array
    ContentType?: string
  }): Promise<void>

  getObject(params: {
    Bucket: string
    Key: string
  }): Promise<{ Body: Uint8Array }>

  deleteObject(params: {
    Bucket: string
    Key: string
  }): Promise<void>

  headBucket(params: {
    Bucket: string
  }): Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S3 cold storage configuration.
 */
export interface S3ColdStorageConfig {
  /** Pre-configured S3-compatible client (injected, not owned) */
  client: S3LikeClient
  /** Target bucket name */
  bucket: string
  /** Key prefix for all evidence objects (e.g., 'tracehound/evidence/') */
  prefix?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Binary Envelope Format
// ─────────────────────────────────────────────────────────────────────────────
//
// Offset  Size  Description
// ──────  ────  ────────────────────────
//  0       4    Magic: 0x54 0x48 0x43 0x53 ("THCS")
//  4       2    Version: 0x00 0x01
//  6       4    originalSize (uint32 BE)
// 10       4    compressedSize (uint32 BE)
// 14      64    SHA-256 hash (hex ASCII, 64 bytes)
// 78       N    compressed gzip data
//
// Total header: 78 bytes
// ─────────────────────────────────────────────────────────────────────────────

const ENVELOPE_MAGIC = new Uint8Array([0x54, 0x48, 0x43, 0x53]) // "THCS"
const ENVELOPE_VERSION = 1
const HEADER_SIZE = 78

/**
 * Pack EncodedPayload into a self-contained binary envelope.
 * Used for storage — all metadata is embedded, no sidecar needed.
 */
function packEnvelope(payload: EncodedPayload): Uint8Array {
  const envelope = new Uint8Array(HEADER_SIZE + payload.compressedSize)
  const view = new DataView(envelope.buffer)

  // Magic
  envelope.set(ENVELOPE_MAGIC, 0)

  // Version
  view.setUint16(4, ENVELOPE_VERSION, false) // big-endian

  // originalSize
  view.setUint32(6, payload.originalSize, false)

  // compressedSize
  view.setUint32(10, payload.compressedSize, false)

  // Hash (64 ASCII hex chars)
  const hashBytes = new TextEncoder().encode(payload.hash)
  envelope.set(hashBytes, 14)

  // Compressed data
  envelope.set(payload.compressed, HEADER_SIZE)

  return envelope
}

/**
 * Unpack binary envelope back to EncodedPayload.
 * Returns null if envelope is invalid (wrong magic, version, or size mismatch).
 */
function unpackEnvelope(data: Uint8Array): EncodedPayload | null {
  if (data.length < HEADER_SIZE) {
    return null
  }

  // Verify magic
  for (let i = 0; i < 4; i++) {
    if (data[i] !== ENVELOPE_MAGIC[i]) {
      return null
    }
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  // Verify version
  const version = view.getUint16(4, false)
  if (version !== ENVELOPE_VERSION) {
    return null
  }

  const originalSize = view.getUint32(6, false)
  const compressedSize = view.getUint32(10, false)

  // Verify data length matches
  if (data.length !== HEADER_SIZE + compressedSize) {
    return null
  }

  // Extract hash
  const hashBytes = data.slice(14, 78)
  const hash = new TextDecoder().decode(hashBytes)

  // Extract compressed data
  const compressed = data.slice(HEADER_SIZE, HEADER_SIZE + compressedSize)

  return {
    compressed,
    hash,
    originalSize,
    compressedSize,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// S3 Cold Storage Adapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S3-compatible cold storage adapter.
 *
 * Stores evidence as binary envelopes in any S3-compatible object store.
 * Client is injected — no AWS SDK dependency in core.
 *
 * @example
 * const adapter = new S3ColdStorage({
 *   client: myS3Client,
 *   bucket: 'tracehound-evidence',
 *   prefix: 'prod/evidence/',
 * })
 */
export class S3ColdStorage implements IColdStorageAdapter {
  private readonly client: S3LikeClient
  private readonly bucket: string
  private readonly prefix: string

  constructor(config: S3ColdStorageConfig) {
    this.client = config.client
    this.bucket = config.bucket
    this.prefix = config.prefix ?? 'tracehound/evidence/'
  }

  /**
   * Resolve storage key for an evidence ID.
   */
  private key(id: string): string {
    return `${this.prefix}${id}.thcs`
  }

  async write(id: string, payload: EncodedPayload): Promise<ColdStorageWriteResult> {
    try {
      const envelope = packEnvelope(payload)
      const key = this.key(id)

      await this.client.putObject({
        Bucket: this.bucket,
        Key: key,
        Body: envelope,
        ContentType: 'application/octet-stream',
      })

      return { success: true, id: key }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown S3 write error'
      return { success: false, error: message }
    }
  }

  async read(id: string): Promise<ColdStorageReadResult> {
    try {
      const key = this.key(id)

      const response = await this.client.getObject({
        Bucket: this.bucket,
        Key: key,
      })

      const payload = unpackEnvelope(response.Body)
      if (!payload) {
        return { success: false, error: 'Invalid envelope format' }
      }

      return { success: true, payload }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown S3 read error'
      return { success: false, error: message }
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const key = this.key(id)

      await this.client.deleteObject({
        Bucket: this.bucket,
        Key: key,
      })

      return true
    } catch {
      return false
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.headBucket({ Bucket: this.bucket })
      return true
    } catch {
      return false
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory + Exports
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an S3-compatible cold storage adapter.
 *
 * @param config - S3 client, bucket, and optional key prefix
 * @returns IColdStorageAdapter backed by S3-compatible storage
 */
export function createS3ColdStorage(config: S3ColdStorageConfig): IColdStorageAdapter {
  return new S3ColdStorage(config)
}

// Re-export envelope utilities for advanced use cases (custom adapters)
export { HEADER_SIZE, packEnvelope, unpackEnvelope }
