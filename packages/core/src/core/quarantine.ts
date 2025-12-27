/**
 * Quarantine - priority-based evidence storage with eviction.
 */

import type { Severity } from '../types/common.js'
import type { QuarantineConfig } from '../types/config.js'
import type { EvidenceHandle, NeutralizationRecord, PurgeRecord } from '../types/evidence.js'
import type { AuditChain } from './audit-chain.js'

/** Result of insert operation */
export interface InsertResult {
  status: 'inserted' | 'duplicate'
  existing?: EvidenceHandle
}

/** Quarantine statistics */
export interface QuarantineStats {
  count: number
  bytes: number
  bySeverity: Record<Severity, number>
}

/** Result of replace operation */
export interface ReplaceResult {
  status: 'replaced' | 'inserted_only'
  neutralized?: NeutralizationRecord
  inserted: boolean
  duplicate?: EvidenceHandle
}

/** Severity ranking for eviction priority */
const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
}

/**
 * Quarantine storage with priority-based eviction.
 * Stores evidence by signature and evicts lowest priority when limits exceeded.
 */
export class Quarantine {
  private store = new Map<string, EvidenceHandle>()
  private totalBytes = 0

  constructor(private config: QuarantineConfig, private auditChain: AuditChain) {}

  /**
   * Insert evidence into quarantine.
   * Triggers eviction if limits exceeded.
   */
  insert(evidence: EvidenceHandle): InsertResult {
    // Check duplicate
    if (this.store.has(evidence.signature)) {
      return {
        status: 'duplicate',
        existing: this.store.get(evidence.signature)!,
      }
    }

    // Insert new evidence
    this.store.set(evidence.signature, evidence)
    this.totalBytes += evidence.size

    // Evict if limits exceeded
    while (this.exceedsLimits()) {
      this.evict(1)
    }

    return { status: 'inserted' }
  }

  /**
   * Get evidence by signature.
   */
  get(signature: string): EvidenceHandle | null {
    return this.store.get(signature) ?? null
  }

  /**
   * Check if signature exists in quarantine.
   */
  has(signature: string): boolean {
    return this.store.has(signature)
  }

  /**
   * Neutralize evidence by signature.
   * Removes from quarantine and appends to audit chain.
   */
  neutralize(signature: string): NeutralizationRecord | null {
    const evidence = this.store.get(signature)
    if (!evidence) {
      return null
    }

    // Get size before neutralize (evidence will be disposed)
    const size = evidence.size

    // Neutralize with audit chain
    const record = evidence.neutralize(this.auditChain.lastHash)
    this.auditChain.append(record)

    // Remove from store
    this.store.delete(signature)
    this.totalBytes -= size

    return record
  }

  /**
   * Flush all evidence from quarantine.
   * Returns all neutralization records.
   */
  flush(): NeutralizationRecord[] {
    const records: NeutralizationRecord[] = []

    for (const [signature, evidence] of this.store) {
      const record = evidence.neutralize(this.auditChain.lastHash)
      this.auditChain.append(record)
      records.push(record)
    }

    // Clear store
    this.store.clear()
    this.totalBytes = 0

    return records
  }

  /**
   * Purge evidence by signature with explicit reason.
   * Unlike neutralize, purge creates a PurgeRecord with reason metadata.
   *
   * @param signature - Evidence signature to purge
   * @param reason - Reason for purge
   * @returns PurgeRecord if found, null if not found
   */
  purge(signature: string, reason: 'timeout' | 'error' | 'abort' | 'panic'): PurgeRecord | null {
    const evidence = this.store.get(signature)
    if (!evidence) {
      return null
    }

    const size = evidence.size
    const hash = evidence.hash

    // Create purge record before disposing
    const record: PurgeRecord = {
      id: `prg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      reason,
      scent: {
        id: evidence.signature, // Using signature as proxy for scent ID
        source: 'unknown', // Not available from evidence handle
        timestamp: evidence.captured,
        payloadHash: hash,
        payloadSize: size,
      },
      purgeTimestamp: Date.now(),
    }

    // Dispose evidence (force cleanup without audit chain)
    try {
      evidence.transfer() // Transfer ownership to force disposal
    } catch {
      // Already disposed, ignore
    }

    // Remove from store
    this.store.delete(signature)
    this.totalBytes -= size

    return record
  }

  /**
   * Replace evidence with new evidence atomically.
   * Old evidence is neutralized and new evidence is inserted.
   *
   * @param oldSignature - Signature of evidence to replace
   * @param newEvidence - New evidence to insert
   * @returns Result with old neutralization record and new insert status
   */
  replace(oldSignature: string, newEvidence: EvidenceHandle): ReplaceResult {
    // First, neutralize old evidence
    const neutralized = this.neutralize(oldSignature)

    if (!neutralized) {
      // Old evidence not found, just insert new
      const insertResult = this.insert(newEvidence)
      return {
        status: 'inserted_only',
        inserted: insertResult.status === 'inserted',
      }
    }

    // Insert new evidence
    const insertResult = this.insert(newEvidence)

    return {
      status: 'replaced',
      neutralized,
      inserted: insertResult.status === 'inserted',
      ...(insertResult.status === 'duplicate' && { duplicate: insertResult.existing }),
    }
  }

  /**
   * Get current quarantine statistics.
   */
  get stats(): QuarantineStats {
    const bySeverity: Record<Severity, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    }

    for (const evidence of this.store.values()) {
      bySeverity[evidence.severity]++
    }

    return {
      count: this.store.size,
      bytes: this.totalBytes,
      bySeverity,
    }
  }

  /**
   * Evict lowest priority evidence.
   */
  private evict(count: number): void {
    const victims = this.selectForEviction(count)

    for (const evidence of victims) {
      const size = evidence.size
      const signature = evidence.signature

      // Neutralize and append to audit chain
      const record = evidence.neutralize(this.auditChain.lastHash)
      this.auditChain.append(record)

      // Remove from store
      this.store.delete(signature)
      this.totalBytes -= size

      // NOTE: Eviction is tracked via audit chain neutralization record.
      // High/critical severity alerts are handled by Watcher observing quarantine stats.
    }
  }

  /**
   * Select evidence for eviction based on priority.
   * Lowest severity first, then oldest.
   */
  private selectForEviction(count: number): EvidenceHandle[] {
    const all = Array.from(this.store.values())

    // Sort: lowest severity first, then oldest
    all.sort((a, b) => {
      const severityDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
      if (severityDiff !== 0) {
        return severityDiff
      }
      // Same severity: oldest first
      return a.captured - b.captured
    })

    return all.slice(0, count)
  }

  /**
   * Check if quarantine exceeds configured limits.
   */
  private exceedsLimits(): boolean {
    return this.store.size > this.config.maxCount || this.totalBytes > this.config.maxBytes
  }
}
