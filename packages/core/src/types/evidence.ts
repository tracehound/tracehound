/**
 * Evidence handling types and records.
 */

import type { Severity } from './common.js'

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
  /** Previous record hash in audit chain */
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
  /** Reason for purge */
  reason: 'timeout' | 'error' | 'abort' | 'panic'
  /** Minimal scent snapshot (hash only, not full payload) */
  scent: {
    id: string
    source: string
    timestamp: number
    payloadHash: string
    payloadSize: number
  }
  /** Timestamp of purge */
  purgeTimestamp: number
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

  /**
   * Transfer ownership of bytes.
   * Handle becomes disposed after transfer.
   */
  transfer(): ArrayBuffer

  /**
   * Atomically snapshot and destroy evidence.
   * Returns neutralization record.
   *
   * @param previousHash - Last hash in audit chain
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
