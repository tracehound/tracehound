/**
 * Forensic audit layer for the soak harness.
 *
 * Two output streams:
 *
 *   logs/forensic.jsonl
 *     One record per notification event emitted by Tracehound.
 *     Captures: threat.detected, evidence.quarantined, evidence.evicted,
 *     rate_limit.exceeded, system.panic — with full typed payloads.
 *     Use this to reconstruct the event timeline during an incident review.
 *
 *   logs/audit-chain.jsonl
 *     Periodic drain of the AuditChain.  Only newly-sealed records are
 *     appended each interval (watermark-based incremental export).
 *     Each record carries its Merkle batch root and chain link hashes,
 *     making tampering detectable offline.
 *
 * Neither file contains raw request payloads — the soak server never
 * surfaces payload data outside the quarantine boundary, so these files
 * are safe to ship to a SIEM or cold-storage archival pipeline.
 */

import type {
  EventType,
  EvidenceEvictedPayload,
  EvidenceQuarantinedPayload,
  HoundResult,
  INotificationEmitter,
  ITracehound,
  RateLimitExceededPayload,
  SystemPanicPayload,
  ThreatDetectedPayload,
  TracehoundEvent,
} from '@tracehound/core'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ─────────────────────────────────────────────────────────────────────────────
// Paths
// ─────────────────────────────────────────────────────────────────────────────

const PKG_ROOT = join(fileURLToPath(import.meta.url), '..', '..') // infrastructure/soak/
const LOGS_DIR = join(PKG_ROOT, 'logs')
const FORENSIC_FILE = join(LOGS_DIR, 'forensic.jsonl')
const AUDIT_CHAIN_FILE = join(LOGS_DIR, 'audit-chain.jsonl')

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Forensic event record written to forensic.jsonl */
interface ForensicRecord {
  ts: number
  eventId: string
  type: EventType | 'hound.result'
  payload: unknown
}

export interface AuditLogger {
  start(): void
  stop(): void
  /** Running counts per event type — readable without acquiring the file. */
  readonly counts: Readonly<EventCounts>
}

interface EventCounts {
  threatDetected: number
  evidenceQuarantined: number
  evidenceEvicted: number
  rateLimitExceeded: number
  systemPanic: number
  houndProcessed: number
  houndTimeout: number
  houndError: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function appendJson(file: string, value: unknown): void {
  try {
    appendFileSync(file, JSON.stringify(value) + '\n', 'utf8')
  } catch {
    // Non-fatal: soak harness must not crash because of a logging write error.
  }
}

function renderEventLine(type: EventType, counts: EventCounts): string {
  const ts = new Date().toISOString()
  return `[${ts}] forensic event: ${type} | counts: threat=${counts.threatDetected} quar=${counts.evidenceQuarantined} evicted=${counts.evidenceEvicted} rl=${counts.rateLimitExceeded} panic=${counts.systemPanic}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createAuditLogger(th: ITracehound, auditIntervalMs: number = 10_000): AuditLogger {
  mkdirSync(LOGS_DIR, { recursive: true })

  const counts: EventCounts = {
    threatDetected: 0,
    evidenceQuarantined: 0,
    evidenceEvicted: 0,
    rateLimitExceeded: 0,
    systemPanic: 0,
    houndProcessed: 0,
    houndTimeout: 0,
    houndError: 0,
  }

  // ── Notification event handlers ────────────────────────────────────────────

  const emitter: INotificationEmitter = th.notifications

  function handleThreatDetected(event: TracehoundEvent<ThreatDetectedPayload>): void {
    counts.threatDetected++
    const record: ForensicRecord = {
      ts: event.timestamp,
      eventId: event.id,
      type: event.type,
      payload: event.payload,
    }
    appendJson(FORENSIC_FILE, record)
    process.stdout.write(renderEventLine(event.type, counts) + '\n')
  }

  function handleEvidenceQuarantined(event: TracehoundEvent<EvidenceQuarantinedPayload>): void {
    counts.evidenceQuarantined++
    const record: ForensicRecord = {
      ts: event.timestamp,
      eventId: event.id,
      type: event.type,
      payload: event.payload,
    }
    appendJson(FORENSIC_FILE, record)
    process.stdout.write(renderEventLine(event.type, counts) + '\n')
  }

  function handleEvidenceEvicted(event: TracehoundEvent<EvidenceEvictedPayload>): void {
    counts.evidenceEvicted++
    const record: ForensicRecord = {
      ts: event.timestamp,
      eventId: event.id,
      type: event.type,
      payload: event.payload,
    }
    appendJson(FORENSIC_FILE, record)
    process.stdout.write(renderEventLine(event.type, counts) + '\n')
  }

  function handleRateLimitExceeded(event: TracehoundEvent<RateLimitExceededPayload>): void {
    counts.rateLimitExceeded++
    const record: ForensicRecord = {
      ts: event.timestamp,
      eventId: event.id,
      type: event.type,
      payload: event.payload,
    }
    appendJson(FORENSIC_FILE, record)
    // Suppress per-event stdout for rate-limit (very noisy at high RPS) —
    // the running counter in metrics output covers it adequately.
  }

  function handleSystemPanic(event: TracehoundEvent<SystemPanicPayload>): void {
    counts.systemPanic++
    const record: ForensicRecord = {
      ts: event.timestamp,
      eventId: event.id,
      type: event.type,
      payload: event.payload,
    }
    appendJson(FORENSIC_FILE, record)
    process.stderr.write(`[forensic] SYSTEM PANIC: ${JSON.stringify(event.payload)}\n`)
  }

  // ── HoundPool result handler ───────────────────────────────────────────────

  function handleHoundResult(result: HoundResult): void {
    const ts = Date.now()
    if (result.status === 'processed') {
      counts.houndProcessed++
    } else if (result.status === 'timeout') {
      counts.houndTimeout++
    } else {
      counts.houndError++
    }
    const record: ForensicRecord = {
      ts,
      eventId: result.processId,
      type: 'hound.result',
      payload: {
        source: 'hound',
        signature: result.signature,
        status: result.status,
        durationMs: result.durationMs,
        processId: result.processId,
        ...(result.error !== undefined ? { error: result.error } : {}),
        ...(result.analysis !== undefined ? { analysis: result.analysis } : {}),
      },
    }
    appendJson(FORENSIC_FILE, record)
    const counts_ = counts
    const ts_ = new Date(ts).toISOString()
    process.stdout.write(
      `[${ts_}] hound result: sig=${result.signature.slice(0, 16)}... status=${result.status} dur=${result.durationMs}ms | hound: ok=${counts_.houndProcessed} timeout=${counts_.houndTimeout} err=${counts_.houndError}\n`,
    )
  }

  // ── AuditChain drain ───────────────────────────────────────────────────────

  /** Number of AuditChain records already exported (watermark). */
  let exportedCount = 0

  function drainAuditChain(): void {
    // Flush any pending events into sealed batches first.
    th.auditChain.flushPending()

    const all = th.auditChain.export()
    const newRecords = all.slice(exportedCount)

    if (newRecords.length === 0) return

    for (const record of newRecords) {
      appendJson(AUDIT_CHAIN_FILE, record)
    }

    exportedCount += newRecords.length
    process.stdout.write(
      `[${new Date().toISOString()}] audit-chain drain: +${newRecords.length} records (total=${exportedCount}) lastHash=${all[all.length - 1]?.hash?.slice(0, 16) ?? 'n/a'}...\n`,
    )
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  let drainTimerId: NodeJS.Timeout | null = null

  return {
    get counts(): Readonly<EventCounts> {
      return counts
    },

    start(): void {
      process.stdout.write(
        `[soak] forensic log   → ${FORENSIC_FILE}\n[soak] audit-chain log → ${AUDIT_CHAIN_FILE}\n`,
      )

      emitter.on('threat.detected', handleThreatDetected as Parameters<typeof emitter.on>[1])
      emitter.on(
        'evidence.quarantined',
        handleEvidenceQuarantined as Parameters<typeof emitter.on>[1],
      )
      emitter.on('evidence.evicted', handleEvidenceEvicted as Parameters<typeof emitter.on>[1])
      emitter.on('rate_limit.exceeded', handleRateLimitExceeded as Parameters<typeof emitter.on>[1])
      emitter.on('system.panic', handleSystemPanic as Parameters<typeof emitter.on>[1])

      // HoundPool — no offResult API; handler is registered once and stays active
      th.houndPool.onResult(handleHoundResult)

      // Immediate first drain, then on interval
      drainAuditChain()
      drainTimerId = setInterval(drainAuditChain, auditIntervalMs)
    },

    stop(): void {
      emitter.off('threat.detected', handleThreatDetected as Parameters<typeof emitter.on>[1])
      emitter.off(
        'evidence.quarantined',
        handleEvidenceQuarantined as Parameters<typeof emitter.on>[1],
      )
      emitter.off('evidence.evicted', handleEvidenceEvicted as Parameters<typeof emitter.on>[1])
      emitter.off(
        'rate_limit.exceeded',
        handleRateLimitExceeded as Parameters<typeof emitter.on>[1],
      )
      emitter.off('system.panic', handleSystemPanic as Parameters<typeof emitter.on>[1])

      if (drainTimerId !== null) {
        clearInterval(drainTimerId)
        drainTimerId = null
      }

      // Final drain before shutdown to capture any lingering records.
      drainAuditChain()

      process.stdout.write(`[soak] forensic shutdown: ${JSON.stringify(counts)}\n`)
    },
  }
}
