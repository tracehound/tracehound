/**
 * Evidence class - quarantined threat evidence with ownership semantics.
 *
 * Phase 2 implementation.
 */

import type { Severity } from '../types/common.js'
import { Errors } from '../types/errors.js'
import type { EvacuateRecord, EvidenceHandle, NeutralizationRecord } from '../types/evidence.js'
import { hashBuffer } from '../utils/hash.js'
import { generateSecureId } from '../utils/id.js'

/**
 * Evidence class implementing EvidenceHandle interface.
 * Provides ownership-based access to quarantined threat data.
 */
export class Evidence implements EvidenceHandle {
  private _bytes: ArrayBuffer | null
  private _disposed: boolean = false
  private readonly _compressed: boolean

  constructor(
    bytes: ArrayBuffer,
    private readonly _signature: string,
    private readonly _expectedHash: string,
    private readonly _severity: Severity,
    private readonly _captured: number,
    compressed: boolean = false
  ) {
    // Validate bytes type
    if (!(bytes instanceof ArrayBuffer)) {
      throw Errors.invalidBytesType()
    }

    // Validate non-empty
    if (bytes.byteLength === 0) {
      throw Errors.emptyEvidence()
    }

    // Verify hash matches bytes ONLY for uncompressed evidence
    // For compressed evidence, hash is of uncompressed content (per RFC)
    if (!compressed) {
      const actualHash = hashBuffer(bytes)
      if (actualHash !== _expectedHash) {
        throw Errors.hashMismatch(_expectedHash, actualHash)
      }
    }

    this._bytes = bytes
    this._compressed = compressed
  }

  // ─── Getters ────────────────────────────────────────────────────────────────

  get bytes(): ArrayBuffer {
    if (this._disposed) {
      throw Errors.evidenceAlreadyDisposed(this._signature)
    }
    return this._bytes!
  }

  get size(): number {
    return this._bytes?.byteLength ?? 0
  }

  get hash(): string {
    return this._expectedHash
  }

  get signature(): string {
    return this._signature
  }

  get captured(): number {
    return this._captured
  }

  get severity(): Severity {
    return this._severity
  }

  get disposed(): boolean {
    return this._disposed
  }

  // ─── Operations ─────────────────────────────────────────────────────────────

  /**
   * Transfer ownership of bytes.
   * Handle becomes disposed after transfer.
   */
  transfer(): ArrayBuffer {
    if (this._disposed) {
      throw Errors.evidenceAlreadyDisposed(this._signature)
    }

    const bytes = this._bytes!
    this._bytes = null
    this._disposed = true

    return bytes
  }

  /**
   * Atomically snapshot and destroy evidence.
   * Returns neutralization record for audit chain.
   *
   * @param previousHash - Last hash in audit chain
   */
  neutralize(previousHash: string): NeutralizationRecord {
    if (this._disposed) {
      throw Errors.evidenceAlreadyDisposed(this._signature)
    }

    // ATOMIC: Snapshot BEFORE any mutation
    const record: NeutralizationRecord = {
      id: generateSecureId(),
      signature: this._signature,
      hash: this._expectedHash,
      size: this._bytes!.byteLength,
      status: 'neutralized',
      timestamp: Date.now(),
      previousHash,
    }

    // ATOMIC: Destroy immediately (no async, no gaps)
    this._bytes = null
    this._disposed = true

    // Return snapshot
    return record
  }

  /**
   * Move evidence to cold storage.
   * Returns evacuation record.
   *
   * @param destination - Cold storage URL
   */
  evacuate(destination: string): EvacuateRecord {
    if (this._disposed) {
      throw Errors.evidenceAlreadyDisposed(this._signature)
    }

    // ATOMIC: Snapshot BEFORE any mutation
    const record: EvacuateRecord = {
      id: generateSecureId(),
      signature: this._signature,
      destination,
      timestamp: Date.now(),
      compressed: false, // TODO: Phase 3 compression
      size: this._bytes!.byteLength,
    }

    // ATOMIC: Destroy immediately
    this._bytes = null
    this._disposed = true

    return record
  }
}
