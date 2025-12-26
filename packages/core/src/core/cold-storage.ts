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
 */

import type { EncodedPayload } from '../utils/binary-codec.js'

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

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Implementation (Testing)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-memory cold storage for testing.
 * NOT for production use.
 */
export class MemoryColdStorage implements IColdStorageAdapter {
  private readonly storage = new Map<string, EncodedPayload>()

  async write(id: string, payload: EncodedPayload): Promise<ColdStorageWriteResult> {
    this.storage.set(id, payload)
    return { success: true, id }
  }

  async read(id: string): Promise<ColdStorageReadResult> {
    const payload = this.storage.get(id)
    if (payload) {
      return { success: true, payload }
    }
    return { success: false, error: 'Not found' }
  }

  async delete(id: string): Promise<boolean> {
    return this.storage.delete(id)
  }

  async isAvailable(): Promise<boolean> {
    return true
  }

  /** Get storage size (testing helper) */
  get size(): number {
    return this.storage.size
  }

  /** Clear all storage (testing helper) */
  clear(): void {
    this.storage.clear()
  }
}

/**
 * Create an in-memory cold storage adapter for testing.
 */
export function createMemoryColdStorage(): IColdStorageAdapter {
  return new MemoryColdStorage()
}
