/**
 * Evidence handling types and records.
 */

import type { Severity } from './common.js'
import type { ScentSource } from './scent.js'

/**
 * Record of a neutralized evidence.
 * Created when evidence is destroyed with atomic snapshot.
 */
export interface NeutralizationRecord {
  /** Unique record ID */
  id: string
  /** Threat signature */
  signature: string
  /** Content hash */
  hash: string
  /** Original size in bytes */
  size: number
  /** Record status */
  status: 'neutralized'
  /** Timestamp of neutralization */
  timestamp: number
  /** Sealed chain anchor observed when this lifecycle record was captured */
  previousHash: string
}

/**
 * Record of evacuated evidence.
 * Created when evidence is moved to cold storage.
 */
export interface EvacuateRecord {
  /** Unique record ID */
  id: string
  /** Threat signature */
  signature: string
  /** Cold storage destination URL */
  destination: string
  /** Timestamp of evacuation */
  timestamp: number
  /** Whether payload was compressed */
  compressed: boolean
  /** Size in bytes (after compression if applicable) */
  size: number
}

/**
 * Record of purged evidence.
 * Created during controlled destruction (timeout, error, panic).
 */
export interface PurgeRecord {
  /** Unique record ID */
  id: string
  /** Threat signature */
  signature: string
  /** Content hash */
  hash: string
  /** Original size in bytes */
  size: number
  /** Record status */
  status: 'purged'
  /** Reason for purge */
  reason: 'timeout' | 'error' | 'abort' | 'panic'
  /** Minimal scent snapshot (hash only, not full payload) */
  scent: {
    id: string
    source: ScentSource
    timestamp: number
    payloadHash: string
    payloadSize: number
  }
  /** Timestamp of purge */
  timestamp: number
  /** Sealed chain anchor observed when this lifecycle record was captured */
  previousHash: string
}

/**
 * Record of evidence evicted from quarantine to make room.
 * Created when stored evidence is displaced by priority-based eviction.
 * Distinct from NeutralizationRecord (deliberate) and DropRecord (at ingestion).
 */
export interface EvictionRecord {
  /** Unique record ID */
  id: string
  /** Threat signature */
  signature: string
  /** Content hash */
  hash: string
  /** Size in bytes */
  size: number
  /** Record status */
  status: 'evicted'
  /** Eviction trigger */
  reason: 'capacity' | 'pressure'
  /** Timestamp of eviction */
  timestamp: number
  /** Sealed chain anchor observed when this lifecycle record was captured */
  previousHash: string
}

/**
 * Record of dropped incoming evidence.
 * Created when evidence is rejected at ingestion due to capacity/size/pressure.
 * Ensures audit atomicity — every drop is traceable.
 */
export interface DropRecord {
  /** Unique record ID */
  id: string
  /** Threat signature */
  signature: string
  /** Content hash */
  hash: string
  /** Size in bytes */
  size: number
  /** Record status */
  status: 'dropped'
  /** Reason for dropping */
  reason: 'oversized' | 'capacity' | 'pressure'
  /** Timestamp of drop */
  timestamp: number
  /** Sealed chain anchor observed when this lifecycle record was captured */
  previousHash: string
}

/**
 * Record of evidence decay after TTL expiry.
 * Created during background quarantine decay processing.
 */
export interface DecayRecord {
  /** Unique record ID */
  id: string
  /** Threat signature */
  signature: string
  /** Content hash */
  hash: string
  /** Original size in bytes */
  size: number
  /** Record status */
  status: 'decayed'
  /** Decay reason */
  reason: 'ttl_expired'
  /** Timestamp of decay */
  timestamp: number
  /** Sealed chain anchor observed when this lifecycle record was captured */
  previousHash: string
  /** Whether decay archived bytes to cold storage */
  archived: boolean
  /** Optional cold storage identifier */
  storageId?: string | undefined
  /** Optional archival failure reason */
  storageError?: string | undefined
}

/**
 * Handle to quarantined evidence.
 * Provides ownership-based access to evidence data.
 */
export interface EvidenceHandle {
  /** Encoded evidence bytes */
  readonly bytes: ArrayBuffer
  /** Size in bytes */
  readonly size: number
  /** Content hash (SHA-256) */
  readonly hash: string
  /** Threat signature */
  readonly signature: string
  /** Capture timestamp */
  readonly captured: number
  /** Threat severity */
  readonly severity: Severity
  /** Whether this handle has been disposed */
  readonly disposed: boolean
  /** Whether stored bytes are compressed */
  readonly compressed: boolean
  /** Source metadata for forensic enrichment */
  readonly source: ScentSource

  /**
   * Transfer ownership of bytes.
   * Handle becomes disposed after transfer.
   */
  transfer(): ArrayBuffer

  /**
   * Atomically snapshot and destroy evidence.
   * Returns neutralization record.
   *
   * @param previousHash - Current sealed chain anchor at capture time
   */
  neutralize(previousHash: string): NeutralizationRecord

  /**
   * Move evidence to cold storage.
   * Returns evacuation record.
   *
   * @param destination - Cold storage URL
   */
  evacuate(destination: string): EvacuateRecord
}
