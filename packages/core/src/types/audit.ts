/**
 * Audit chain types for evidence integrity.
 */

import type {
  DecayRecord,
  DropRecord,
  EvacuateRecord,
  EvictionRecord,
  NeutralizationRecord,
  PurgeRecord,
} from './evidence.js'

/**
 * Audit lifecycle event accepted by the audit chain.
 */
export type AuditLifecycleRecord =
  | NeutralizationRecord
  | EvacuateRecord
  | PurgeRecord
  | DecayRecord
  | DropRecord
  | EvictionRecord

/**
 * Audit record in the hash chain.
 */
export interface AuditRecord {
  /** Unique record ID */
  id: string
  /** Record type */
  type: 'neutralization' | 'evacuation' | 'purge' | 'decay' | 'drop' | 'eviction'
  /** Threat signature */
  signature: string
  /** Timestamp of action */
  timestamp: number
  /** Deterministic serialized lifecycle metadata */
  eventData: string
  /** SHA-256 hash of eventData */
  eventHash: string
  /** Hash of this record */
  hash: string
  /** Hash of previous record (chain link) */
  previousHash: string
  /** Logical batch identifier */
  batchId: string
  /** Merkle root of the batch */
  batchRoot: string
  /** Zero-based position within the sealed batch */
  batchIndex: number
  /** Total number of events inside the sealed batch */
  batchSize: number
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
  append(record: AuditLifecycleRecord): void

  /**
   * Seal pending lifecycle events into a Merkle batch immediately.
   */
  flushPending(): void

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
