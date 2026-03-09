/**
 * Quarantine - priority-based evidence storage with eviction.
 */

import type { Severity } from '../types/common.js'
import type { QuarantineConfig } from '../types/config.js'
import type {
  DecayRecord,
  DropRecord,
  EvictionRecord,
  EvidenceHandle,
  NeutralizationRecord,
  PurgeRecord,
} from '../types/evidence.js'
import { encodeWithIntegrityAsync } from '../utils/binary-codec.js'
import { generateSecureId } from '../utils/id.js'
import type { AuditChain } from './audit-chain.js'
import type { IColdStorageAdapter } from './cold-storage.js'

/** Result of insert operation */
export interface InsertResult {
  status: 'inserted' | 'duplicate' | 'dropped'
  existing?: EvidenceHandle
  reason?: 'oversized' | 'capacity' | 'pressure'
}

/** Quarantine statistics */
export interface QuarantineStats {
  count: number
  bytes: number
  droppedCount: number
  droppedBytes: number
  evictedCount: number
  decayedCount: number
  archivedCount: number
  archiveFailureCount: number
  ttlEnabled: boolean
  nextExpiryAt: number | null
  bySeverity: Record<Severity, number>
}

/** Result of replace operation */
export interface ReplaceResult {
  status: 'replaced' | 'inserted_only'
  neutralized?: NeutralizationRecord
  inserted: boolean
  duplicate?: EvidenceHandle
}

export interface DecayResult {
  decayedCount: number
  archivedCount: number
  archiveFailureCount: number
  retainedCount: number
}

export interface QuarantineDependencies {
  coldStorage?: IColdStorageAdapter
  now?: () => number
}

/** Severity ranking for eviction priority */
const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
}

function createSeverityCounters(): Record<Severity, number> {
  return {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  }
}

/**
 * Quarantine storage with priority-based eviction.
 * Stores evidence by signature and evicts lowest priority when limits exceeded.
 */
export class Quarantine {
  private store = new Map<string, EvidenceHandle>()
  private readonly expirations = new Map<string, number>()
  private readonly decayingSignatures = new Set<string>()
  private readonly severityCounts = createSeverityCounters()
  private totalBytes = 0
  private droppedCount = 0
  private droppedBytes = 0
  private evictedCount = 0
  private decayedCount = 0
  private archivedCount = 0
  private archiveFailureCount = 0
  private nextExpiryAt: number | null = null
  private readonly coldStorage: IColdStorageAdapter | undefined
  private readonly now: () => number

  constructor(
    private config: QuarantineConfig,
    private auditChain: AuditChain,
    dependencies: QuarantineDependencies = {},
  ) {
    this.coldStorage = dependencies.coldStorage
    this.now = dependencies.now ?? Date.now
  }

  /**
   * Insert evidence into quarantine.
   * Triggers deterministic Drop and Count when limits are exceeded.
   */
  insert(evidence: EvidenceHandle): InsertResult {
    // Check duplicate
    if (this.store.has(evidence.signature)) {
      return {
        status: 'duplicate',
        existing: this.store.get(evidence.signature)!,
      }
    }

    // Hard-cap guard: impossible to retain this evidence.
    if (this.config.maxCount <= 0 || this.config.maxBytes <= 0) {
      this.dropIncoming(evidence, 'capacity')
      return {
        status: 'dropped',
        reason: 'capacity',
      }
    }

    if (evidence.size > this.config.maxBytes) {
      this.dropIncoming(evidence, 'oversized')
      return {
        status: 'dropped',
        reason: 'oversized',
      }
    }

    // Insert new evidence first, then rebalance deterministically.
    this.store.set(evidence.signature, evidence)
    this.trackExpiry(evidence)
    this.incrementSeverity(evidence.severity)
    this.totalBytes += evidence.size

    // Evict until limits are satisfied.
    while (this.exceedsLimits()) {
      const victim = this.selectForEviction(1)[0]
      if (!victim) {
        break
      }

      const disposition = victim.signature === evidence.signature ? 'drop' : 'eviction'
      this.dropStored(victim, disposition, 'pressure')
    }

    if (!this.store.has(evidence.signature)) {
      return {
        status: 'dropped',
        reason: 'pressure',
      }
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
    const severity = evidence.severity

    // Neutralize with audit chain
    const record = evidence.neutralize(this.auditChain.lastHash)
    this.auditChain.append(record)

    // Remove from store
    this.removeStoredEvidence(signature, size, severity)

    return record
  }

  /**
   * Flush all evidence from quarantine.
   * Returns all neutralization records.
   */
  flush(): NeutralizationRecord[] {
    const records: NeutralizationRecord[] = []

    for (const [_signature, evidence] of this.store) {
      const record = evidence.neutralize(this.auditChain.lastHash)
      this.auditChain.append(record)
      records.push(record)
    }

    this.resetStoreState()

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
    const severity = evidence.severity

    // Create purge record before disposing
    const record: PurgeRecord = {
      id: `prg-${generateSecureId()}`,
      signature,
      hash,
      size,
      status: 'purged',
      reason,
      scent: {
        // Fall back to signature when scentId is absent (e.g. legacy/custom handles)
        // to preserve audit traceability.
        id: evidence.scentId || signature,
        source: evidence.source,
        timestamp: evidence.captured,
        payloadHash: hash,
        payloadSize: size,
      },
      timestamp: this.now(),
      previousHash: this.auditChain.lastHash,
    }

    this.auditChain.append(record)

    // Dispose evidence after writing audit metadata
    try {
      evidence.transfer()
    } catch {
      // Already disposed, ignore
    }

    // Remove from store
    this.removeStoredEvidence(signature, size, severity)

    return record
  }

  /**
   * Decay expired evidence outside the hot path.
   * Expired entries are processed deterministically and optionally archived.
   */
  async decayExpired(now: number = this.now()): Promise<DecayResult> {
    const expired = this.selectExpired(now)
    let decayedCount = 0
    let archivedCount = 0
    let archiveFailureCount = 0
    let retainedCount = 0

    for (const evidence of expired) {
      const outcome = await this.processDecay(evidence, now)
      decayedCount += outcome.decayedCount
      archivedCount += outcome.archivedCount
      archiveFailureCount += outcome.archiveFailureCount
      retainedCount += outcome.retainedCount
    }

    return {
      decayedCount,
      archivedCount,
      archiveFailureCount,
      retainedCount,
    }
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
      ...(insertResult.status === 'duplicate' && {
        duplicate: insertResult.existing,
      }),
    }
  }

  /**
   * Get current quarantine statistics.
   */
  get stats(): QuarantineStats {
    return {
      count: this.store.size,
      bytes: this.totalBytes,
      droppedCount: this.droppedCount,
      droppedBytes: this.droppedBytes,
      evictedCount: this.evictedCount,
      decayedCount: this.decayedCount,
      archivedCount: this.archivedCount,
      archiveFailureCount: this.archiveFailureCount,
      ttlEnabled: this.isTtlEnabled(),
      nextExpiryAt: this.getNextExpiryAt(),
      bySeverity: { ...this.severityCounts },
    }
  }

  /**
   * Get the configured maximum bytes limit.
   * Used by Agent to pass capacity context to Watcher.
   */
  get maxBytes(): number {
    return this.config.maxBytes
  }

  /**
   * Select evidence for eviction based on priority.
   * Lowest severity first, then oldest, then signature for deterministic ties.
   */
  private selectForEviction(count: number): EvidenceHandle[] {
    if (count <= 0 || this.store.size === 0) {
      return []
    }

    const limit = Math.min(count, this.store.size)
    const victims: EvidenceHandle[] = []

    for (const evidence of this.store.values()) {
      let inserted = false

      for (let index = 0; index < victims.length; index += 1) {
        const current = victims[index]
        if (current !== undefined && compareEvictionPriority(evidence, current) < 0) {
          victims.splice(index, 0, evidence)
          inserted = true
          break
        }
      }

      if (!inserted && victims.length < limit) {
        victims.push(evidence)
      }

      if (victims.length > limit) {
        victims.pop()
      }
    }

    return victims
  }

  /**
   * Check if quarantine exceeds configured limits.
   */
  private exceedsLimits(): boolean {
    return this.store.size > this.config.maxCount || this.totalBytes > this.config.maxBytes
  }

  private dropIncoming(evidence: EvidenceHandle, reason: DropRecord['reason']): void {
    const size = evidence.size
    const record: DropRecord = {
      id: `drp-${generateSecureId()}`,
      signature: evidence.signature,
      hash: evidence.hash,
      size,
      status: 'dropped',
      reason,
      timestamp: this.now(),
      previousHash: this.auditChain.lastHash,
    }

    this.auditChain.append(record)

    this.droppedCount++
    this.droppedBytes += size

    try {
      evidence.transfer()
    } catch {
      // Best-effort disposal only.
    }
  }

  private dropStored(
    evidence: EvidenceHandle,
    disposition: 'drop' | 'eviction',
    reason: 'capacity' | 'pressure',
  ): void {
    const size = evidence.size
    const signature = evidence.signature

    if (disposition === 'drop') {
      const record: DropRecord = {
        id: `drp-${generateSecureId()}`,
        signature,
        hash: evidence.hash,
        size,
        status: 'dropped',
        reason,
        timestamp: this.now(),
        previousHash: this.auditChain.lastHash,
      }

      this.auditChain.append(record)
    } else {
      const record: EvictionRecord = {
        id: `evc-${generateSecureId()}`,
        signature,
        hash: evidence.hash,
        size,
        status: 'evicted',
        reason,
        timestamp: this.now(),
        previousHash: this.auditChain.lastHash,
      }

      this.auditChain.append(record)
    }

    try {
      evidence.transfer()
    } catch {
      // Best-effort disposal only.
    }

    this.removeStoredEvidence(signature, size, evidence.severity)

    if (disposition === 'drop') {
      this.droppedCount++
      this.droppedBytes += size
    } else {
      this.evictedCount++
    }
  }

  private isTtlEnabled(): boolean {
    return typeof this.config.ttlMs === 'number' && this.config.ttlMs > 0
  }

  private trackExpiry(evidence: EvidenceHandle): void {
    if (!this.isTtlEnabled()) {
      this.expirations.delete(evidence.signature)
      this.nextExpiryAt = null
      return
    }

    const ttlMs = this.config.ttlMs ?? 0
    const expiry = evidence.captured + ttlMs
    this.expirations.set(evidence.signature, expiry)
    if (this.nextExpiryAt === null || expiry < this.nextExpiryAt) {
      this.nextExpiryAt = expiry
    }
  }

  private getNextExpiryAt(): number | null {
    return this.isTtlEnabled() ? this.nextExpiryAt : null
  }

  private selectExpired(now: number): EvidenceHandle[] {
    if (!this.isTtlEnabled()) {
      return []
    }

    if (this.nextExpiryAt === null && this.expirations.size > 0) {
      this.recomputeNextExpiryAt()
    }

    if (this.nextExpiryAt === null || this.nextExpiryAt > now) {
      return []
    }

    const candidates: EvidenceHandle[] = []

    for (const [signature, expiry] of this.expirations) {
      if (expiry <= now) {
        if (this.decayingSignatures.has(signature)) {
          continue
        }

        const evidence = this.store.get(signature)
        if (evidence) {
          candidates.push(evidence)
        } else {
          // Self-heal TTL index when backing evidence has already been removed.
          this.clearExpiryTracking(signature)
        }
      }
    }

    candidates.sort((left, right) => {
      const leftExpiry = this.expirations.get(left.signature) ?? left.captured
      const rightExpiry = this.expirations.get(right.signature) ?? right.captured
      if (leftExpiry !== rightExpiry) {
        return leftExpiry - rightExpiry
      }

      const severityDiff = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
      if (severityDiff !== 0) {
        return severityDiff
      }

      return left.signature.localeCompare(right.signature)
    })

    const batchSize = normalizeDecayBatchSize(this.config.decayBatchSize)
    return candidates.slice(0, batchSize)
  }

  private async processDecay(evidence: EvidenceHandle, now: number): Promise<DecayResult> {
    if (!this.store.has(evidence.signature) || this.decayingSignatures.has(evidence.signature)) {
      return {
        decayedCount: 0,
        archivedCount: 0,
        archiveFailureCount: 0,
        retainedCount: 0,
      }
    }

    this.decayingSignatures.add(evidence.signature)

    // Remove from expirations synchronously before the first await so that
    // concurrent decayExpired() calls (e.g. from back-to-back scheduler ticks)
    // cannot re-select this entry while archival is in flight.
    this.clearExpiryTracking(evidence.signature)

    const signature = evidence.signature
    const hash = evidence.hash
    const size = evidence.size

    try {
      const archiveAttempted = this.config.archiveOnDecay !== false
      let archived = false
      let storageId: string | undefined
      let storageError: string | undefined

      if (archiveAttempted) {
        try {
          const archiveBytes = new Uint8Array(evidence.bytes.slice(0))
          const archiveResult = await this.archiveEvidence(signature, archiveBytes)
          archived = archiveResult.archived
          storageId = archiveResult.storageId
          storageError = archiveResult.storageError
        } catch {
          archived = false
          storageError = 'evidence unavailable for archival'
        }
      }

      // Evidence may have been removed while archival was in-flight.
      const current = this.store.get(signature)
      const stillOwned = current === evidence

      if (archiveAttempted && !archived && this.config.archiveFailureMode === 'retain') {
        if (stillOwned && !evidence.disposed) {
          // Re-track expiry so the entry is retried on the next decay cycle.
          this.trackExpiry(evidence)
          this.archiveFailureCount++
          return {
            decayedCount: 0,
            archivedCount: 0,
            archiveFailureCount: 1,
            retainedCount: 1,
          }
        }

        return {
          decayedCount: 0,
          archivedCount: 0,
          archiveFailureCount: 0,
          retainedCount: 0,
        }
      }

      if (!stillOwned) {
        return {
          decayedCount: 0,
          archivedCount: 0,
          archiveFailureCount: 0,
          retainedCount: 0,
        }
      }

      const record: DecayRecord = {
        id: `dcy-${generateSecureId()}`,
        signature,
        hash,
        size,
        status: 'decayed',
        reason: 'ttl_expired',
        timestamp: now,
        previousHash: this.auditChain.lastHash,
        archived,
        storageId,
        storageError,
      }

      this.auditChain.append(record)

      try {
        evidence.transfer()
      } catch {
        // Best-effort disposal only.
      }

      this.removeStoredEvidence(signature, record.size, evidence.severity)
      this.decayedCount++

      if (archived) {
        this.archivedCount++
      } else if (archiveAttempted) {
        this.archiveFailureCount++
      }

      return {
        decayedCount: 1,
        archivedCount: archived ? 1 : 0,
        archiveFailureCount: archiveAttempted && !archived ? 1 : 0,
        retainedCount: 0,
      }
    } finally {
      this.decayingSignatures.delete(evidence.signature)
    }
  }

  private incrementSeverity(severity: Severity): void {
    this.severityCounts[severity] += 1
  }

  private decrementSeverity(severity: Severity): void {
    this.severityCounts[severity] = Math.max(0, this.severityCounts[severity] - 1)
  }

  private removeStoredEvidence(signature: string, size: number, severity: Severity): void {
    this.store.delete(signature)
    this.clearExpiryTracking(signature)
    this.totalBytes = Math.max(0, this.totalBytes - size)
    this.decrementSeverity(severity)
  }

  private clearExpiryTracking(signature: string): void {
    const expiry = this.expirations.get(signature)
    if (expiry === undefined) {
      return
    }

    this.expirations.delete(signature)

    if (expiry === this.nextExpiryAt) {
      this.recomputeNextExpiryAt()
    }
  }

  private recomputeNextExpiryAt(): void {
    if (!this.isTtlEnabled() || this.expirations.size === 0) {
      this.nextExpiryAt = null
      return
    }

    let nextExpiryAt: number | null = null
    for (const expiry of this.expirations.values()) {
      if (nextExpiryAt === null || expiry < nextExpiryAt) {
        nextExpiryAt = expiry
      }
    }

    this.nextExpiryAt = nextExpiryAt
  }

  private resetStoreState(): void {
    this.store.clear()
    this.expirations.clear()
    this.totalBytes = 0
    this.nextExpiryAt = null
    this.severityCounts.low = 0
    this.severityCounts.medium = 0
    this.severityCounts.high = 0
    this.severityCounts.critical = 0
  }

  private async archiveEvidence(
    signature: string,
    bytes: Uint8Array,
  ): Promise<{ archived: boolean; storageId?: string; storageError?: string }> {
    if (!this.coldStorage) {
      return {
        archived: false,
        storageError: 'cold storage not configured',
      }
    }

    const timeoutMs = normalizeArchiveTimeout(this.config.archiveTimeoutMs)
    const controller = new AbortController()

    const archivePromise = this.runArchive(signature, bytes, controller.signal)

    const timeoutPromise = new Promise<{
      archived: boolean
      storageError: string
    }>((resolve) => {
      const tid = setTimeout(() => {
        controller.abort()
        resolve({
          archived: false,
          storageError: `archive timed out after ${timeoutMs}ms`,
        })
      }, timeoutMs)
      // Prevent the timer from keeping the Node.js event loop alive.
      if (typeof (tid as unknown as { unref?: () => void }).unref === 'function') {
        ;(tid as unknown as { unref: () => void }).unref()
      }
      // Cancel the timeout once the archive promise settles first.
      archivePromise.then(() => clearTimeout(tid)).catch(() => clearTimeout(tid))
    })

    try {
      return await Promise.race([archivePromise, timeoutPromise])
    } catch (err) {
      // Real adapter/encode error — sanitize before returning.
      return {
        archived: false,
        storageError: sanitizeStorageError(err instanceof Error ? err.message : 'unknown'),
      }
    }
  }

  private async runArchive(
    signature: string,
    bytes: Uint8Array,
    signal: AbortSignal,
  ): Promise<{ archived: boolean; storageId?: string; storageError?: string }> {
    if (signal.aborted) {
      return { archived: false, storageError: 'archive cancelled' }
    }

    const availability = await this.coldStorage!.isAvailable()
    if (signal.aborted) {
      return { archived: false, storageError: 'archive cancelled' }
    }

    if (!availability) {
      return {
        archived: false,
        storageError: 'cold storage unavailable',
      }
    }

    const encoded = await encodeWithIntegrityAsync(bytes)
    if (signal.aborted) {
      return { archived: false, storageError: 'archive cancelled' }
    }

    const result = await this.coldStorage!.write(signature, encoded, signal)
    const archiveResult: {
      archived: boolean
      storageId?: string
      storageError?: string
    } = {
      archived: result.success,
    }

    if (result.id !== undefined) {
      archiveResult.storageId = result.id
    }
    if (result.error !== undefined) {
      archiveResult.storageError = sanitizeStorageError(result.error)
    }

    return archiveResult
  }
}

function compareEvictionPriority(left: EvidenceHandle, right: EvidenceHandle): number {
  const severityDiff = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
  if (severityDiff !== 0) {
    return severityDiff
  }

  const capturedDiff = left.captured - right.captured
  if (capturedDiff !== 0) {
    return capturedDiff
  }

  return left.signature.localeCompare(right.signature)
}

function normalizeDecayBatchSize(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 128
  }

  return Math.floor(value)
}

function normalizeArchiveTimeout(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 5_000
  }

  return Math.floor(value)
}

/**
 * Strip internal storage error details before persisting to audit chain.
 * Bucket names, ARNs, endpoint URLs, and credentials must not leak
 * into forensic exports or logs (information disclosure risk).
 */
function sanitizeStorageError(error: string): string {
  if (typeof error !== 'string' || error.length === 0) {
    return 'storage write failed'
  }

  // Truncate to prevent log injection via oversized error strings
  // Replace potential endpoint/credential fragments on the full string first
  const redacted = error
    .replace(/https?:\/\/\S+/gi, '[endpoint]')
    .replace(/arn:[a-z0-9:/_\-]+/gi, '[arn]')
    .replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '[key]')
    // Redact generic high-entropy tokens (32+ hex or base64 chars) to prevent
    // credential/secret exfiltration via error messages.
    .replace(/\b[A-Za-z0-9+/_-]{32,}={0,2}(?![\w-])/g, '[token]')

  const sanitized = redacted.trim() || 'storage write failed'

  // Truncate after redaction to prevent log injection via oversized strings.
  // Bounded max length (120) limits information leakage; strings shorter than
  // 120 chars remain shorter — this is not a fixed-length (padded) output.
  return sanitized.slice(0, 120)
}
