/**
 * AuditChain - cryptographic hash chain for evidence integrity.
 */

import { createHash, createHmac } from 'node:crypto'
import type { AuditLifecycleRecord, AuditRecord, IAuditChain } from '../types/audit.js'

/** Genesis hash (anchor for chain) */
export const GENESIS_HASH = '0'.repeat(64)

interface AuditChainOptions {
  hmacSecret?: string
  batchWindowMs?: number
  /**
   * Maximum sealed records to keep in memory (FIFO eviction).
   * Default: 100_000. Set 0 for unlimited (not recommended in production).
   */
  maxRecords?: number
}

interface PendingAuditEvent {
  readonly id: string
  readonly type: AuditRecord['type']
  readonly signature: string
  readonly timestamp: number
  readonly eventData: string
  readonly eventHash: string
}

const DEFAULT_BATCH_WINDOW_MS = 1_000

/**
 * Cryptographic hash chain for audit integrity.
 * Lifecycle events are sealed into Merkle batches to reduce per-event chain overhead.
 */
const DEFAULT_MAX_RECORDS = 100_000

export class AuditChain implements IAuditChain {
  private readonly records: AuditRecord[] = []
  private readonly pendingEvents: PendingAuditEvent[] = []
  private _lastHash = GENESIS_HASH
  private _batchCounter = 0
  private readonly hmacSecret: string | undefined
  private readonly batchWindowMs: number
  private readonly maxRecords: number

  constructor(config?: string | AuditChainOptions) {
    if (typeof config === 'string') {
      this.hmacSecret = config
      this.batchWindowMs = DEFAULT_BATCH_WINDOW_MS
      this.maxRecords = DEFAULT_MAX_RECORDS
      return
    }

    this.hmacSecret = config?.hmacSecret
    this.batchWindowMs = normalizeBatchWindow(config?.batchWindowMs)
    this.maxRecords = normalizeMaxRecords(config?.maxRecords)
  }

  get lastHash(): string {
    return this._lastHash
  }

  get length(): number {
    return this.records.length + this.pendingEvents.length
  }

  append(record: AuditLifecycleRecord): void {
    const pending = toPendingAuditEvent(record, (data) => this.digest(data))

    if (this.shouldSealBeforeAppend(pending.timestamp)) {
      this.sealPending()
    }

    this.pendingEvents.push(pending)
  }

  flushPending(): void {
    this.sealPending()
  }

  verify(): boolean {
    this.sealPending()

    let expectedPreviousHash = GENESIS_HASH
    let index = 0

    while (index < this.records.length) {
      const head = this.records[index]
      if (!head) {
        return false
      }

      const batch = this.collectBatch(index, head.batchId)
      if (batch.length === 0) {
        return false
      }

      const eventHashes: string[] = []
      for (const record of batch) {
        const recomputedEventHash = this.digest(record.eventData)
        if (recomputedEventHash !== record.eventHash) {
          return false
        }
        eventHashes.push(recomputedEventHash)
      }

      const expectedBatchRoot = buildMerkleRoot(eventHashes, (data) => this.digest(data))

      if (expectedBatchRoot !== head.batchRoot) {
        return false
      }

      const expectedChainHash = this.digest(
        JSON.stringify({
          batchRoot: head.batchRoot,
          previousHash: expectedPreviousHash,
          batchId: head.batchId,
          batchSize: batch.length,
        }),
      )

      for (let batchIndex = 0; batchIndex < batch.length; batchIndex++) {
        const record = batch[batchIndex]
        if (!record) {
          return false
        }

        if (
          record.previousHash !== expectedPreviousHash ||
          record.hash !== expectedChainHash ||
          record.batchRoot !== head.batchRoot ||
          record.batchSize !== batch.length ||
          record.batchIndex !== batchIndex
        ) {
          return false
        }
      }

      expectedPreviousHash = expectedChainHash
      index += batch.length
    }

    return true
  }

  export(): AuditRecord[] {
    this.sealPending()
    return [...this.records]
  }

  private shouldSealBeforeAppend(timestamp: number): boolean {
    const firstPending = this.pendingEvents[0]
    if (!firstPending) {
      return false
    }

    return timestamp - firstPending.timestamp >= this.batchWindowMs
  }

  private sealPending(): void {
    if (this.pendingEvents.length === 0) {
      return
    }

    const previousHash = this._lastHash
    const pending = this.pendingEvents.splice(0, this.pendingEvents.length)
    const batchRoot = buildMerkleRoot(
      pending.map((event) => event.eventHash),
      (data) => this.digest(data),
    )
    const batchId = `batch-${pending[0]!.timestamp}-${this._batchCounter++}`
    const chainHash = this.digest(
      JSON.stringify({
        batchRoot,
        previousHash,
        batchId,
        batchSize: pending.length,
      }),
    )

    pending.forEach((event, batchIndex) => {
      this.records.push({
        id: event.id,
        type: event.type,
        signature: event.signature,
        timestamp: event.timestamp,
        eventData: event.eventData,
        eventHash: event.eventHash,
        previousHash,
        hash: chainHash,
        batchId,
        batchRoot,
        batchIndex,
        batchSize: pending.length,
      })
    })

    this._lastHash = chainHash

    // FIFO rotation: evict oldest records when cap exceeded.
    if (this.maxRecords > 0 && this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords)
    }
  }

  private collectBatch(startIndex: number, batchId: string): AuditRecord[] {
    const batch: AuditRecord[] = []

    for (let index = startIndex; index < this.records.length; index++) {
      const record = this.records[index]
      if (!record || record.batchId !== batchId) {
        break
      }
      batch.push(record)
    }

    return batch
  }

  private digest(data: string): string {
    if (this.hmacSecret) {
      return createHmac('sha256', this.hmacSecret).update(data).digest('hex')
    }

    return createHash('sha256').update(data).digest('hex')
  }
}

function normalizeBatchWindow(batchWindowMs: number | undefined): number {
  if (typeof batchWindowMs !== 'number' || !Number.isFinite(batchWindowMs) || batchWindowMs <= 0) {
    return DEFAULT_BATCH_WINDOW_MS
  }

  return Math.floor(batchWindowMs)
}

function normalizeMaxRecords(maxRecords: number | undefined): number {
  if (typeof maxRecords !== 'number' || !Number.isFinite(maxRecords) || maxRecords < 0) {
    return DEFAULT_MAX_RECORDS
  }

  return Math.floor(maxRecords)
}

function toPendingAuditEvent(
  record: AuditLifecycleRecord,
  digest: (data: string) => string,
): PendingAuditEvent {
  const normalized = normalizeLifecycleRecord(record)
  const eventData = JSON.stringify(normalized)

  return {
    id: normalized.id,
    type: normalized.type,
    signature: normalized.signature,
    timestamp: normalized.timestamp,
    eventData,
    eventHash: digest(eventData),
  }
}

function normalizeLifecycleRecord(record: AuditLifecycleRecord): {
  id: string
  type: AuditRecord['type']
  signature: string
  timestamp: number
  details: Record<string, boolean | number | string | null>
} {
  if ('status' in record && record.status === 'neutralized') {
    return {
      id: record.id,
      type: 'neutralization',
      signature: record.signature,
      timestamp: record.timestamp,
      details: {
        hash: record.hash,
        size: record.size,
      },
    }
  }

  if ('destination' in record) {
    return {
      id: record.id,
      type: 'evacuation',
      signature: record.signature,
      timestamp: record.timestamp,
      details: {
        destination: record.destination,
        compressed: record.compressed,
        size: record.size,
      },
    }
  }

  if ('status' in record && record.status === 'purged') {
    return {
      id: record.id,
      type: 'purge',
      signature: record.signature,
      timestamp: record.timestamp,
      details: {
        hash: record.hash,
        size: record.size,
        reason: record.reason,
        source: record.scent.source,
      },
    }
  }

  if ('status' in record && record.status === 'dropped') {
    return {
      id: record.id,
      type: 'drop',
      signature: record.signature,
      timestamp: record.timestamp,
      details: {
        hash: record.hash,
        size: record.size,
        reason: record.reason,
      },
    }
  }

  if ('status' in record && record.status === 'evicted') {
    return {
      id: record.id,
      type: 'eviction',
      signature: record.signature,
      timestamp: record.timestamp,
      details: {
        hash: record.hash,
        size: record.size,
        reason: record.reason,
      },
    }
  }

  return {
    id: record.id,
    type: 'decay',
    signature: record.signature,
    timestamp: record.timestamp,
    details: {
      hash: record.hash,
      size: record.size,
      archived: record.archived,
      reason: record.reason,
      storageId: record.storageId ?? null,
      storageError: record.storageError ?? null,
    },
  }
}

function buildMerkleRoot(leaves: readonly string[], digest: (data: string) => string): string {
  if (leaves.length === 0) {
    return digest('[]')
  }

  let level = [...leaves]

  while (level.length > 1) {
    const nextLevel: string[] = []

    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]
      const right = level[index + 1] ?? left
      nextLevel.push(digest(`${left}${right}`))
    }

    level = nextLevel
  }

  return level[0]!
}
