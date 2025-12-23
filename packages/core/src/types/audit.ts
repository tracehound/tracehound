/**
 * Audit chain types for evidence integrity.
 */

import type { EvacuateRecord, NeutralizationRecord } from './evidence.js'

/**
 * Audit record in the hash chain.
 */
export interface AuditRecord {
  /** Unique record ID */
  id: string
  /** Record type */
  type: 'neutralization' | 'evacuation'
  /** Threat signature */
  signature: string
  /** Timestamp of action */
  timestamp: number
  /** Hash of this record */
  hash: string
  /** Hash of previous record (chain link) */
  previousHash: string
}

/**
 * Cryptographic hash chain for audit integrity.
 */
export interface IAuditChain {
  /** Hash of last record (or genesis) */
  readonly lastHash: string
  /** Number of records in chain */
  readonly length: number

  /**
   * Append a record to the chain.
   * Computes hash and links to previous.
   */
  append(record: NeutralizationRecord | EvacuateRecord): void

  /**
   * Verify chain integrity.
   * Returns true if chain is unbroken and untampered.
   */
  verify(): boolean

  /**
   * Export all records (defensive copy).
   */
  export(): AuditRecord[]
}
