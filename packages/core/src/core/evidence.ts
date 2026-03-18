/**
 * Evidence class - quarantined threat evidence with ownership semantics.
 *
 * Phase 2 implementation.
 */

import type { Severity } from '../types/common.js'
import { Errors } from '../types/errors.js'
import type { EvacuateRecord, EvidenceHandle, NeutralizationRecord } from '../types/evidence.js'
import type { ScentSource } from '../types/scent.js'
import { constantTimeEqual } from '../utils/compare.js'
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
  private readonly _now: () => number
  private readonly _source: ScentSource

  constructor(
    bytes: ArrayBuffer,
    private readonly _signature: string,
    private readonly _expectedHash: string,
    private readonly _severity: Severity,
    private readonly _captured: number,
    source: ScentSource,
    compressed: boolean = false,
    private readonly _scentId: string = '',
    private readonly _monoNs: bigint = 0n,
    // TODO: refactor constructor to options object when mono + now are both stabilized.
    now: () => number = Date.now,
  ) {
    // Validate bytes type
    if (!(bytes instanceof ArrayBuffer)) {
      throw Errors.evidenceInvalidBytes()
    }

    // Validate non-empty
    if (bytes.byteLength === 0) {
      throw Errors.evidenceEmpty()
    }

    // Verify hash matches bytes ONLY for uncompressed evidence
    // For compressed evidence, hash is of uncompressed content (per RFC)
    if (!compressed) {
      const actualHash = hashBuffer(bytes)
      if (!constantTimeEqual(actualHash, _expectedHash)) {
        throw Errors.evidenceHashMismatch(_expectedHash, actualHash)
      }
    }

    this._bytes = bytes
    this._compressed = compressed
    this._now = now
    this._source = snapshotSourceMetadata(source)
  }

  // ─── Getters ────────────────────────────────────────────────────────────────

  get bytes(): ArrayBuffer {
    if (this._disposed) {
      throw Errors.evidenceAlreadyDisposed(this._signature)
    }
    // Defensive copy: callers must not be able to mutate the internal buffer
    // in-place via a Uint8Array view. Without this copy a caller could open a
    // view on the returned ArrayBuffer and silently overwrite forensic bytes
    // while the Evidence handle remains non-disposed — a post-capture tampering
    // path not covered by the construction-time hash check.
    return this._bytes!.slice(0)
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

  get scentId(): string {
    return this._scentId
  }

  get captured(): number {
    return this._captured
  }

  get monoNs(): bigint {
    return this._monoNs
  }

  get severity(): Severity {
    return this._severity
  }

  get disposed(): boolean {
    return this._disposed
  }

  get compressed(): boolean {
    return this._compressed
  }

  get source(): ScentSource {
    return this._source
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
   * @param previousHash - Current sealed chain anchor at capture time
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
      timestamp: this._now(),
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
      timestamp: this._now(),
      compressed: this._compressed,
      size: this._bytes!.byteLength,
    }

    // ATOMIC: Destroy immediately
    this._bytes = null
    this._disposed = true

    return record
  }
}

function snapshotSourceMetadata(source: ScentSource): ScentSource {
  const ip = typeof source.ip === 'string' && source.ip.length > 0 ? source.ip : 'unknown'
  const userAgent =
    typeof source.userAgent === 'string' && source.userAgent.length > 0
      ? source.userAgent
      : undefined

  const tlsSource = source.tls
  const tls =
    tlsSource && typeof tlsSource === 'object'
      ? Object.freeze({
          cipherSuite:
            typeof tlsSource.cipherSuite === 'string' && tlsSource.cipherSuite.length > 0
              ? tlsSource.cipherSuite
              : 'unknown',
          version:
            typeof tlsSource.version === 'string' && tlsSource.version.length > 0
              ? tlsSource.version
              : 'unknown',
          ...(typeof tlsSource.alpn === 'string' && tlsSource.alpn.length > 0
            ? { alpn: tlsSource.alpn }
            : {}),
        })
      : undefined

  return Object.freeze({
    ip,
    ...(userAgent !== undefined ? { userAgent } : {}),
    ...(tls !== undefined ? { tls } : {}),
  })
}
