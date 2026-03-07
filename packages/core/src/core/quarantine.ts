/**
 * Quarantine - priority-based evidence storage with eviction.
 */

import type { Severity } from "../types/common.js";
import type { QuarantineConfig } from "../types/config.js";
import type {
  DecayRecord,
  DropRecord,
  EvictionRecord,
  EvidenceHandle,
  NeutralizationRecord,
  PurgeRecord,
} from "../types/evidence.js";
import { encodeWithIntegrityAsync } from "../utils/binary-codec.js";
import { generateSecureId } from "../utils/id.js";
import type { AuditChain } from "./audit-chain.js";
import type { IColdStorageAdapter } from "./cold-storage.js";

/** Result of insert operation */
export interface InsertResult {
  status: "inserted" | "duplicate" | "dropped";
  existing?: EvidenceHandle;
  reason?: "oversized" | "capacity" | "pressure";
}

/** Quarantine statistics */
export interface QuarantineStats {
  count: number;
  bytes: number;
  droppedCount: number;
  droppedBytes: number;
  decayedCount: number;
  archivedCount: number;
  archiveFailureCount: number;
  ttlEnabled: boolean;
  nextExpiryAt: number | null;
  bySeverity: Record<Severity, number>;
}

/** Result of replace operation */
export interface ReplaceResult {
  status: "replaced" | "inserted_only";
  neutralized?: NeutralizationRecord;
  inserted: boolean;
  duplicate?: EvidenceHandle;
}

export interface DecayResult {
  decayedCount: number;
  archivedCount: number;
  archiveFailureCount: number;
  retainedCount: number;
}

export interface QuarantineDependencies {
  coldStorage?: IColdStorageAdapter;
  now?: () => number;
}

/** Severity ranking for eviction priority */
const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

class ArchiveTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super("archive timeout");
    this.name = "ArchiveTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Quarantine storage with priority-based eviction.
 * Stores evidence by signature and evicts lowest priority when limits exceeded.
 */
export class Quarantine {
  private store = new Map<string, EvidenceHandle>();
  private readonly expirations = new Map<string, number>();
  private readonly decayingSignatures = new Set<string>();
  private totalBytes = 0;
  private droppedCount = 0;
  private droppedBytes = 0;
  private decayedCount = 0;
  private archivedCount = 0;
  private archiveFailureCount = 0;
  private readonly coldStorage: IColdStorageAdapter | undefined;
  private readonly now: () => number;

  constructor(
    private config: QuarantineConfig,
    private auditChain: AuditChain,
    dependencies: QuarantineDependencies = {},
  ) {
    this.coldStorage = dependencies.coldStorage;
    this.now = dependencies.now ?? Date.now;
  }

  /**
   * Insert evidence into quarantine.
   * Triggers deterministic Drop and Count when limits are exceeded.
   */
  insert(evidence: EvidenceHandle): InsertResult {
    // Check duplicate
    if (this.store.has(evidence.signature)) {
      return {
        status: "duplicate",
        existing: this.store.get(evidence.signature)!,
      };
    }

    // Hard-cap guard: impossible to retain this evidence.
    if (this.config.maxCount <= 0 || this.config.maxBytes <= 0) {
      this.dropIncoming(evidence, "capacity");
      return {
        status: "dropped",
        reason: "capacity",
      };
    }

    if (evidence.size > this.config.maxBytes) {
      this.dropIncoming(evidence, "oversized");
      return {
        status: "dropped",
        reason: "oversized",
      };
    }

    // Insert new evidence first, then rebalance deterministically.
    this.store.set(evidence.signature, evidence);
    this.trackExpiry(evidence);
    this.totalBytes += evidence.size;

    // Evict until limits are satisfied.
    while (this.exceedsLimits()) {
      const victim = this.selectForEviction(1)[0];
      if (!victim) {
        break;
      }

      const disposition =
        victim.signature === evidence.signature ? "drop" : "eviction";
      this.dropStored(victim, disposition, "pressure");
    }

    if (!this.store.has(evidence.signature)) {
      return {
        status: "dropped",
        reason: "pressure",
      };
    }

    return { status: "inserted" };
  }

  /**
   * Get evidence by signature.
   */
  get(signature: string): EvidenceHandle | null {
    return this.store.get(signature) ?? null;
  }

  /**
   * Check if signature exists in quarantine.
   */
  has(signature: string): boolean {
    return this.store.has(signature);
  }

  /**
   * Neutralize evidence by signature.
   * Removes from quarantine and appends to audit chain.
   */
  neutralize(signature: string): NeutralizationRecord | null {
    const evidence = this.store.get(signature);
    if (!evidence) {
      return null;
    }

    // Get size before neutralize (evidence will be disposed)
    const size = evidence.size;

    // Neutralize with audit chain
    const record = evidence.neutralize(this.auditChain.lastHash);
    this.auditChain.append(record);

    // Remove from store
    this.store.delete(signature);
    this.expirations.delete(signature);
    this.totalBytes -= size;

    return record;
  }

  /**
   * Flush all evidence from quarantine.
   * Returns all neutralization records.
   */
  flush(): NeutralizationRecord[] {
    const records: NeutralizationRecord[] = [];

    for (const [_signature, evidence] of this.store) {
      const record = evidence.neutralize(this.auditChain.lastHash);
      this.auditChain.append(record);
      records.push(record);
    }

    // Clear store
    this.store.clear();
    this.expirations.clear();
    this.totalBytes = 0;

    return records;
  }

  /**
   * Purge evidence by signature with explicit reason.
   * Unlike neutralize, purge creates a PurgeRecord with reason metadata.
   *
   * @param signature - Evidence signature to purge
   * @param reason - Reason for purge
   * @returns PurgeRecord if found, null if not found
   */
  purge(
    signature: string,
    reason: "timeout" | "error" | "abort" | "panic",
  ): PurgeRecord | null {
    const evidence = this.store.get(signature);
    if (!evidence) {
      return null;
    }

    const size = evidence.size;
    const hash = evidence.hash;

    // Create purge record before disposing
    const record: PurgeRecord = {
      id: `prg-${generateSecureId()}`,
      signature,
      hash,
      size,
      status: "purged",
      reason,
      scent: {
        id: evidence.signature, // Using signature as proxy for scent ID
        source: "unknown", // Not available from evidence handle
        timestamp: evidence.captured,
        payloadHash: hash,
        payloadSize: size,
      },
      timestamp: this.now(),
      previousHash: this.auditChain.lastHash,
    };

    this.auditChain.append(record);

    // Dispose evidence after writing audit metadata
    try {
      evidence.transfer();
    } catch {
      // Already disposed, ignore
    }

    // Remove from store
    this.store.delete(signature);
    this.expirations.delete(signature);
    this.totalBytes -= size;

    return record;
  }

  /**
   * Decay expired evidence outside the hot path.
   * Expired entries are processed deterministically and optionally archived.
   */
  async decayExpired(now: number = this.now()): Promise<DecayResult> {
    const expired = this.selectExpired(now);
    let decayedCount = 0;
    let archivedCount = 0;
    let archiveFailureCount = 0;
    let retainedCount = 0;

    for (const evidence of expired) {
      const outcome = await this.processDecay(evidence, now);
      decayedCount += outcome.decayedCount;
      archivedCount += outcome.archivedCount;
      archiveFailureCount += outcome.archiveFailureCount;
      retainedCount += outcome.retainedCount;
    }

    return {
      decayedCount,
      archivedCount,
      archiveFailureCount,
      retainedCount,
    };
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
    const neutralized = this.neutralize(oldSignature);

    if (!neutralized) {
      // Old evidence not found, just insert new
      const insertResult = this.insert(newEvidence);
      return {
        status: "inserted_only",
        inserted: insertResult.status === "inserted",
      };
    }

    // Insert new evidence
    const insertResult = this.insert(newEvidence);

    return {
      status: "replaced",
      neutralized,
      inserted: insertResult.status === "inserted",
      ...(insertResult.status === "duplicate" && {
        duplicate: insertResult.existing,
      }),
    };
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
    };

    for (const evidence of this.store.values()) {
      bySeverity[evidence.severity]++;
    }

    return {
      count: this.store.size,
      bytes: this.totalBytes,
      droppedCount: this.droppedCount,
      droppedBytes: this.droppedBytes,
      decayedCount: this.decayedCount,
      archivedCount: this.archivedCount,
      archiveFailureCount: this.archiveFailureCount,
      ttlEnabled: this.isTtlEnabled(),
      nextExpiryAt: this.getNextExpiryAt(),
      bySeverity,
    };
  }

  /**
   * Get the configured maximum bytes limit.
   * Used by Agent to pass capacity context to Watcher.
   */
  get maxBytes(): number {
    return this.config.maxBytes;
  }

  /**
   * Select evidence for eviction based on priority.
   * Lowest severity first, then oldest, then signature for deterministic ties.
   */
  private selectForEviction(count: number): EvidenceHandle[] {
    const all = Array.from(this.store.values());

    all.sort((a, b) => {
      const severityDiff =
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (severityDiff !== 0) {
        return severityDiff;
      }

      const capturedDiff = a.captured - b.captured;
      if (capturedDiff !== 0) {
        return capturedDiff;
      }

      return a.signature.localeCompare(b.signature);
    });

    return all.slice(0, count);
  }

  /**
   * Check if quarantine exceeds configured limits.
   */
  private exceedsLimits(): boolean {
    return (
      this.store.size > this.config.maxCount ||
      this.totalBytes > this.config.maxBytes
    );
  }

  private dropIncoming(
    evidence: EvidenceHandle,
    reason: DropRecord["reason"],
  ): void {
    const size = evidence.size;
    const record: DropRecord = {
      id: `drp-${generateSecureId()}`,
      signature: evidence.signature,
      hash: evidence.hash,
      size,
      status: "dropped",
      reason,
      timestamp: this.now(),
      previousHash: this.auditChain.lastHash,
    };

    this.auditChain.append(record);

    this.droppedCount++;
    this.droppedBytes += size;

    try {
      evidence.transfer();
    } catch {
      // Best-effort disposal only.
    }
  }

  private dropStored(
    evidence: EvidenceHandle,
    disposition: "drop" | "eviction",
    reason: "capacity" | "pressure",
  ): void {
    const size = evidence.size;
    const signature = evidence.signature;

    if (disposition === "drop") {
      const record: DropRecord = {
        id: `drp-${generateSecureId()}`,
        signature,
        hash: evidence.hash,
        size,
        status: "dropped",
        reason,
        timestamp: this.now(),
        previousHash: this.auditChain.lastHash,
      };

      this.auditChain.append(record);
    } else {
      const record: EvictionRecord = {
        id: `evc-${generateSecureId()}`,
        signature,
        hash: evidence.hash,
        size,
        status: "evicted",
        reason,
        timestamp: this.now(),
        previousHash: this.auditChain.lastHash,
      };

      this.auditChain.append(record);
    }

    try {
      evidence.transfer();
    } catch {
      // Best-effort disposal only.
    }

    this.store.delete(signature);
    this.expirations.delete(signature);
    this.totalBytes -= size;

    if (disposition === "drop") {
      this.droppedCount++;
      this.droppedBytes += size;
    }
  }

  private isTtlEnabled(): boolean {
    return typeof this.config.ttlMs === "number" && this.config.ttlMs > 0;
  }

  private trackExpiry(evidence: EvidenceHandle): void {
    if (!this.isTtlEnabled()) {
      this.expirations.delete(evidence.signature);
      return;
    }

    const ttlMs = this.config.ttlMs ?? 0;
    this.expirations.set(evidence.signature, evidence.captured + ttlMs);
  }

  private getNextExpiryAt(): number | null {
    let nextExpiryAt: number | null = null;

    for (const expiry of this.expirations.values()) {
      if (nextExpiryAt === null || expiry < nextExpiryAt) {
        nextExpiryAt = expiry;
      }
    }

    return nextExpiryAt;
  }

  private selectExpired(now: number): EvidenceHandle[] {
    if (!this.isTtlEnabled()) {
      return [];
    }

    const candidates: EvidenceHandle[] = [];

    for (const [signature, expiry] of this.expirations) {
      if (expiry <= now) {
        if (this.decayingSignatures.has(signature)) {
          continue;
        }

        const evidence = this.store.get(signature);
        if (evidence) {
          candidates.push(evidence);
        } else {
          // Self-heal TTL index when backing evidence has already been removed.
          this.expirations.delete(signature);
        }
      }
    }

    candidates.sort((left, right) => {
      const leftExpiry = this.expirations.get(left.signature) ?? left.captured;
      const rightExpiry =
        this.expirations.get(right.signature) ?? right.captured;
      if (leftExpiry !== rightExpiry) {
        return leftExpiry - rightExpiry;
      }

      const severityDiff =
        SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
      if (severityDiff !== 0) {
        return severityDiff;
      }

      return left.signature.localeCompare(right.signature);
    });

    const batchSize = normalizeDecayBatchSize(this.config.decayBatchSize);
    return candidates.slice(0, batchSize);
  }

  private async processDecay(
    evidence: EvidenceHandle,
    now: number,
  ): Promise<DecayResult> {
    if (
      !this.store.has(evidence.signature) ||
      this.decayingSignatures.has(evidence.signature)
    ) {
      return {
        decayedCount: 0,
        archivedCount: 0,
        archiveFailureCount: 0,
        retainedCount: 0,
      };
    }

    this.decayingSignatures.add(evidence.signature);

    // Remove from expirations synchronously before the first await so that
    // concurrent decayExpired() calls (e.g. from back-to-back scheduler ticks)
    // cannot re-select this entry while archival is in flight.
    this.expirations.delete(evidence.signature);

    const signature = evidence.signature;
    const hash = evidence.hash;
    const size = evidence.size;

    try {
      const archiveAttempted = this.config.archiveOnDecay !== false;
      let archived = false;
      let storageId: string | undefined;
      let storageError: string | undefined;

      if (archiveAttempted) {
        try {
          const archiveBytes = new Uint8Array(evidence.bytes.slice(0));
          const archiveResult = await this.archiveEvidence(
            signature,
            archiveBytes,
          );
          archived = archiveResult.archived;
          storageId = archiveResult.storageId;
          storageError = archiveResult.storageError;
        } catch {
          archived = false;
          storageError = "evidence unavailable for archival";
        }
      }

      // Evidence may have been removed while archival was in-flight.
      const current = this.store.get(signature);
      const stillOwned = current === evidence;

      if (
        archiveAttempted &&
        !archived &&
        this.config.archiveFailureMode === "retain"
      ) {
        if (stillOwned && !evidence.disposed) {
          // Re-track expiry so the entry is retried on the next decay cycle.
          this.trackExpiry(evidence);
          this.archiveFailureCount++;
          return {
            decayedCount: 0,
            archivedCount: 0,
            archiveFailureCount: 1,
            retainedCount: 1,
          };
        }

        return {
          decayedCount: 0,
          archivedCount: 0,
          archiveFailureCount: 0,
          retainedCount: 0,
        };
      }

      if (!stillOwned) {
        return {
          decayedCount: 0,
          archivedCount: 0,
          archiveFailureCount: 0,
          retainedCount: 0,
        };
      }

      const record: DecayRecord = {
        id: `dcy-${generateSecureId()}`,
        signature,
        hash,
        size,
        status: "decayed",
        reason: "ttl_expired",
        timestamp: now,
        previousHash: this.auditChain.lastHash,
        archived,
        storageId,
        storageError,
      };

      this.auditChain.append(record);

      try {
        evidence.transfer();
      } catch {
        // Best-effort disposal only.
      }

      this.store.delete(signature);
      this.expirations.delete(signature);
      this.totalBytes -= record.size;
      this.decayedCount++;

      if (archived) {
        this.archivedCount++;
      } else if (archiveAttempted) {
        this.archiveFailureCount++;
      }

      return {
        decayedCount: 1,
        archivedCount: archived ? 1 : 0,
        archiveFailureCount: archiveAttempted && !archived ? 1 : 0,
        retainedCount: 0,
      };
    } finally {
      this.decayingSignatures.delete(evidence.signature);
    }
  }

  private async archiveEvidence(
    signature: string,
    bytes: Uint8Array,
  ): Promise<{ archived: boolean; storageId?: string; storageError?: string }> {
    if (!this.coldStorage) {
      return {
        archived: false,
        storageError: "cold storage not configured",
      };
    }

    const timeoutMs = normalizeArchiveTimeout(this.config.archiveTimeoutMs);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const archivePromise = this.runArchive(signature, bytes);
    return await new Promise<{
      archived: boolean;
      storageId?: string;
      storageError?: string;
    }>((resolve) => {
      timeoutId = setTimeout(() => {
        // Timeout fired before archive completed.
        resolve({
          archived: false,
          storageError: `archive timed out after ${timeoutMs}ms`,
        });
      }, timeoutMs);
      // Prevent the timer from keeping the Node.js event loop alive after archive completes.
      if (
        typeof (timeoutId as unknown as { unref?: () => void }).unref ===
        "function"
      ) {
        (timeoutId as unknown as { unref: () => void }).unref();
      }
      archivePromise
        .then((result) => {
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
          }
          resolve(result);
        })
        .catch((err) => {
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
          }
          // Real adapter/encode error — sanitize before returning.
          resolve({
            archived: false,
            storageError: sanitizeStorageError(
              err instanceof Error ? err.message : "unknown",
            ),
          });
        });
    });
  }

  private async runArchive(
    signature: string,
    bytes: Uint8Array,
  ): Promise<{ archived: boolean; storageId?: string; storageError?: string }> {
    const availability = await this.coldStorage!.isAvailable();
    if (!availability) {
      return {
        archived: false,
        storageError: "cold storage unavailable",
      };
    }

    const encoded = await encodeWithIntegrityAsync(bytes);
    const result = await this.coldStorage!.write(signature, encoded);
    const archiveResult: {
      archived: boolean;
      storageId?: string;
      storageError?: string;
    } = {
      archived: result.success,
    };

    if (result.id !== undefined) {
      archiveResult.storageId = result.id;
    }
    if (result.error !== undefined) {
      archiveResult.storageError = sanitizeStorageError(result.error);
    }

    return archiveResult;
  }
}

function normalizeDecayBatchSize(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 128;
  }

  return Math.floor(value);
}

function normalizeArchiveTimeout(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 5_000;
  }

  return Math.floor(value);
}

/**
 * Strip internal storage error details before persisting to audit chain.
 * Bucket names, ARNs, endpoint URLs, and credentials must not leak
 * into forensic exports or logs (information disclosure risk).
 */
function sanitizeStorageError(error: string): string {
  if (typeof error !== "string" || error.length === 0) {
    return "storage write failed";
  }

  // Truncate to prevent log injection via oversized error strings
  const truncated = error.slice(0, 120);

  // Replace potential endpoint/credential fragments
  return (
    truncated
      .replace(/https?:\/\/\S+/gi, "[endpoint]")
      .replace(/arn:[a-z0-9:/_\-]+/gi, "[arn]")
      .replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, "[key]")
      .trim() || "storage write failed"
  );
}
