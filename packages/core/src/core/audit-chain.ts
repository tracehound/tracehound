/**
 * AuditChain - cryptographic hash chain for evidence integrity.
 */

import { createHash } from 'node:crypto'
import type { AuditRecord, IAuditChain } from '../types/audit.js'
import type { EvacuateRecord, NeutralizationRecord } from '../types/evidence.js'

/** Genesis hash (anchor for chain) */
export const GENESIS_HASH = '0'.repeat(64)

/**
 * Cryptographic hash chain for audit integrity.
 * Each record contains hash of previous record.
 * Tampering with any record breaks the chain.
 */
export class AuditChain implements IAuditChain {
  private records: AuditRecord[] = []
  private _lastHash: string = GENESIS_HASH

  get lastHash(): string {
    return this._lastHash
  }

  get length(): number {
    return this.records.length
  }

  /**
   * Append a record to the chain.
   */
  append(record: NeutralizationRecord | EvacuateRecord): void {
    const hash = this.computeHash(record, this._lastHash)

    const auditRecord: AuditRecord = {
      id: record.id,
      type: 'status' in record ? 'neutralization' : 'evacuation',
      signature: record.signature,
      timestamp: record.timestamp,
      previousHash: this._lastHash,
      hash,
    }

    this.records.push(auditRecord)
    this._lastHash = hash
  }

  /**
   * Verify chain integrity.
   */
  verify(): boolean {
    let expectedPreviousHash = GENESIS_HASH

    for (const record of this.records) {
      // Check chain continuity
      if (record.previousHash !== expectedPreviousHash) {
        return false
      }

      // Check hash integrity
      const computedHash = this.recomputeHash(record)
      if (computedHash !== record.hash) {
        return false
      }

      expectedPreviousHash = record.hash
    }

    return true
  }

  /**
   * Export all records (defensive copy).
   */
  export(): AuditRecord[] {
    return [...this.records]
  }

  /**
   * Compute hash for a new record.
   */
  private computeHash(record: NeutralizationRecord | EvacuateRecord, previousHash: string): string {
    const data = JSON.stringify({
      id: record.id,
      signature: record.signature,
      timestamp: record.timestamp,
      previousHash,
    })
    return createHash('sha256').update(data).digest('hex')
  }

  /**
   * Recompute hash for verification.
   */
  private recomputeHash(record: AuditRecord): string {
    const data = JSON.stringify({
      id: record.id,
      signature: record.signature,
      timestamp: record.timestamp,
      previousHash: record.previousHash,
    })
    return createHash('sha256').update(data).digest('hex')
  }
}
