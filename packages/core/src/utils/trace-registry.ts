/**
 * Trace inspection registry.
 *
 * Stores opaque trace-id to metadata mappings in a bounded local NDJSON file.
 * This powers `tracehound inspect` without exposing payload bytes.
 *
 * Design constraints:
 * - Never block request hot path (enqueue-only API)
 * - Bounded memory via queue limits (drop and count)
 * - Fail-open on all storage failures
 */

import { existsSync, readFileSync, statSync, truncateSync, unlinkSync } from 'node:fs'
import { appendFile, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Severity } from '../types/common.js'

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_MAX_ENTRIES = 5_000
const DEFAULT_MAX_FILE_BYTES = 4 * 1024 * 1024
const DEFAULT_MAX_QUEUE_ENTRIES = 1_024
const FLUSH_BATCH_SIZE = 128
const FILE_SIZE_CHECK_INTERVAL_MS = 1_000

export interface TraceInspectionEntry {
  traceId: string
  signature: string
  severity: Severity
  size: number
  captured: number
  source: string
  recordedAt: number
}

export interface TraceRegistryOptions {
  path?: string
  ttlMs?: number
  maxEntries?: number
  maxFileBytes?: number
  maxQueueEntries?: number
}

export interface TraceRegistryStats {
  path: string
  fileExists: boolean
  fileBytes: number
  retainedEntries: number
  uniqueTraceIds: number
  ttlMs: number
  maxEntries: number
  maxFileBytes: number
  maxQueueEntries: number
  queueDepth: number
  droppedCount: number
  blocked: boolean
}

export interface TraceRegistryClearResult {
  path: string
  mode: 'history' | 'disk'
  success: boolean
  removedEntries: number
  removedBytes: number
}

interface TraceRegistryLimits {
  ttlMs: number
  maxEntries: number
  maxFileBytes: number
  maxQueueEntries: number
}

interface RegistryWriterState {
  queue: TraceInspectionEntry[]
  flushing: boolean
  blocked: boolean
  droppedCount: number
  lastSizeCheckAt: number
}

const WRITER_STATES = new Map<string, RegistryWriterState>()

/**
 * Resolve registry path.
 *
 * Priority:
 * 1) explicit options.path
 * 2) TRACEHOUND_TRACE_REGISTRY_PATH
 * 3) OS temp dir default
 */
export function resolveTraceRegistryPath(options?: Pick<TraceRegistryOptions, 'path'>): string {
  if (options?.path && options.path.length > 0) {
    return options.path
  }

  const fromEnv = process.env['TRACEHOUND_TRACE_REGISTRY_PATH']
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    return fromEnv
  }

  return join(tmpdir(), 'tracehound', 'trace-registry.ndjson')
}

/**
 * Non-blocking write path: enqueue and return immediately.
 */
export function recordTraceInspectionEntry(
  entry: Omit<TraceInspectionEntry, 'recordedAt'>,
  options?: TraceRegistryOptions,
): TraceInspectionEntry | null {
  if (!isValidEntryInput(entry)) {
    return null
  }

  const record: TraceInspectionEntry = {
    ...entry,
    recordedAt: Date.now(),
  }

  const path = resolveTraceRegistryPath(options)
  const limits = resolveLimits(options)
  const state = getWriterState(path)

  if (state.blocked) {
    state.droppedCount++
    return record
  }

  enqueueRecord(state, record, limits.maxQueueEntries)
  scheduleFlush(path, limits, state)

  return record
}

export function getTraceInspectionEntry(
  traceId: string,
  options?: TraceRegistryOptions,
): TraceInspectionEntry | null {
  if (typeof traceId !== 'string' || traceId.length === 0) {
    return null
  }

  const path = resolveTraceRegistryPath(options)
  const limits = resolveLimits(options)
  const entries = readEntries(path, limits)
  const combined = includePendingEntries(path, entries, limits)

  for (let i = combined.length - 1; i >= 0; i--) {
    const entry = combined[i]
    if (!entry) {
      continue
    }

    if (entry.traceId === traceId) {
      return entry
    }
  }

  return null
}

export function findTraceInspectionEntryBySignature(
  signature: string,
  options?: TraceRegistryOptions,
): TraceInspectionEntry | null {
  if (typeof signature !== 'string' || signature.length === 0) {
    return null
  }

  const path = resolveTraceRegistryPath(options)
  const limits = resolveLimits(options)
  const entries = readEntries(path, limits)
  const combined = includePendingEntries(path, entries, limits)

  for (let i = combined.length - 1; i >= 0; i--) {
    const entry = combined[i]
    if (!entry) {
      continue
    }

    if (entry.signature === signature) {
      return entry
    }
  }

  return null
}

export function listTraceInspectionEntries(
  limit: number,
  options?: TraceRegistryOptions,
): TraceInspectionEntry[] {
  const path = resolveTraceRegistryPath(options)
  const limits = resolveLimits(options)
  const entries = readEntries(path, limits)
  const combined = includePendingEntries(path, entries, limits)

  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10
  const result: TraceInspectionEntry[] = []
  const seen = new Set<string>()

  for (let i = combined.length - 1; i >= 0; i--) {
    const entry = combined[i]
    if (!entry) {
      continue
    }

    if (seen.has(entry.traceId)) {
      continue
    }

    result.push(entry)
    seen.add(entry.traceId)

    if (result.length >= normalizedLimit) {
      break
    }
  }

  return result
}

export function getTraceRegistryStats(options?: TraceRegistryOptions): TraceRegistryStats {
  const path = resolveTraceRegistryPath(options)
  const limits = resolveLimits(options)
  const entries = readEntries(path, limits)
  const combined = includePendingEntries(path, entries, limits)
  const state = WRITER_STATES.get(path)

  return {
    path,
    fileExists: existsSync(path),
    fileBytes: getFileBytes(path),
    retainedEntries: combined.length,
    uniqueTraceIds: new Set(combined.map((entry) => entry.traceId)).size,
    ttlMs: limits.ttlMs,
    maxEntries: limits.maxEntries,
    maxFileBytes: limits.maxFileBytes,
    maxQueueEntries: limits.maxQueueEntries,
    queueDepth: state?.queue.length ?? 0,
    droppedCount: state?.droppedCount ?? 0,
    blocked: state?.blocked ?? false,
  }
}

export function clearTraceInspectionHistory(
  options?: TraceRegistryOptions,
): TraceRegistryClearResult {
  const path = resolveTraceRegistryPath(options)
  const limits = resolveLimits(options)
  const removedEntries = includePendingEntries(path, readEntries(path, limits), limits).length
  const removedBytes = getFileBytes(path)
  const state = WRITER_STATES.get(path)
  let success = true

  if (state) {
    state.queue.length = 0
    state.blocked = false
    state.droppedCount = 0
    state.lastSizeCheckAt = 0
  }

  if (existsSync(path)) {
    try {
      truncateSync(path, 0)
    } catch {
      success = false
    }
  }

  return {
    path,
    mode: 'history',
    success,
    removedEntries,
    removedBytes,
  }
}

export function clearTraceRegistryDisk(options?: TraceRegistryOptions): TraceRegistryClearResult {
  const path = resolveTraceRegistryPath(options)
  const limits = resolveLimits(options)
  const removedEntries = includePendingEntries(path, readEntries(path, limits), limits).length
  const removedBytes = getFileBytes(path)
  const state = WRITER_STATES.get(path)
  let success = true

  if (state) {
    state.queue.length = 0
    state.blocked = false
    state.droppedCount = 0
    state.lastSizeCheckAt = 0
  }

  if (existsSync(path)) {
    try {
      unlinkSync(path)
    } catch {
      success = false
    }
  }

  return {
    path,
    mode: 'disk',
    success,
    removedEntries,
    removedBytes,
  }
}

function getWriterState(path: string): RegistryWriterState {
  const existing = WRITER_STATES.get(path)
  if (existing) {
    return existing
  }

  const created: RegistryWriterState = {
    queue: [],
    flushing: false,
    blocked: false,
    droppedCount: 0,
    lastSizeCheckAt: 0,
  }
  WRITER_STATES.set(path, created)
  return created
}

function enqueueRecord(
  state: RegistryWriterState,
  record: TraceInspectionEntry,
  maxQueueEntries: number,
): void {
  while (state.queue.length >= maxQueueEntries) {
    state.queue.shift()
    state.droppedCount++
  }

  state.queue.push(record)
}

function scheduleFlush(
  path: string,
  limits: TraceRegistryLimits,
  state: RegistryWriterState,
): void {
  if (state.flushing || state.blocked) {
    return
  }

  state.flushing = true
  queueMicrotask(() => {
    void flushQueue(path, limits, state)
  })
}

async function flushQueue(
  path: string,
  limits: TraceRegistryLimits,
  state: RegistryWriterState,
): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true })

    while (state.queue.length > 0) {
      if (await shouldBlockWrites(path, limits, state)) {
        state.blocked = true
        state.droppedCount += state.queue.length
        state.queue.length = 0
        break
      }

      const batch = state.queue.splice(0, Math.min(FLUSH_BATCH_SIZE, state.queue.length))
      if (batch.length === 0) {
        break
      }

      const payload = `${batch.map((item) => JSON.stringify(item)).join('\n')}\n`

      try {
        await appendFile(path, payload, 'utf8')
      } catch {
        state.droppedCount += batch.length
      }
    }
  } catch {
    // fail-open: do nothing
  } finally {
    state.flushing = false

    if (state.queue.length > 0 && !state.blocked) {
      scheduleFlush(path, limits, state)
    }
  }
}

async function shouldBlockWrites(
  path: string,
  limits: TraceRegistryLimits,
  state: RegistryWriterState,
): Promise<boolean> {
  const now = Date.now()
  if (now - state.lastSizeCheckAt < FILE_SIZE_CHECK_INTERVAL_MS) {
    return state.blocked
  }

  state.lastSizeCheckAt = now

  try {
    if (!existsSync(path)) {
      return false
    }

    const info = await stat(path)
    return info.size >= limits.maxFileBytes
  } catch {
    return false
  }
}

function includePendingEntries(
  path: string,
  entries: TraceInspectionEntry[],
  limits: TraceRegistryLimits,
): TraceInspectionEntry[] {
  const state = WRITER_STATES.get(path)
  if (!state || state.queue.length === 0) {
    return entries
  }

  const cutoff = Date.now() - limits.ttlMs
  const pending = state.queue.filter((entry) => entry.recordedAt >= cutoff)
  if (pending.length === 0) {
    return entries
  }

  const merged = entries.concat(pending)
  if (merged.length > limits.maxEntries) {
    return merged.slice(merged.length - limits.maxEntries)
  }

  return merged
}

function readEntries(path: string, limits: TraceRegistryLimits): TraceInspectionEntry[] {
  if (!existsSync(path)) {
    return []
  }

  try {
    const raw = readFileSync(path, 'utf8')
    if (raw.length === 0) {
      return []
    }

    const cutoff = Date.now() - limits.ttlMs
    const lines = raw.split(/\r?\n/)
    const entries: TraceInspectionEntry[] = []

    for (const line of lines) {
      if (line.length === 0) {
        continue
      }

      try {
        const parsed = JSON.parse(line) as Partial<TraceInspectionEntry>
        if (!isValidParsedEntry(parsed)) {
          continue
        }

        if (parsed.recordedAt < cutoff) {
          continue
        }

        entries.push(parsed)
      } catch {
        // ignore malformed lines
      }
    }

    if (entries.length > limits.maxEntries) {
      return entries.slice(entries.length - limits.maxEntries)
    }

    return entries
  } catch {
    return []
  }
}

function resolveLimits(options?: TraceRegistryOptions): TraceRegistryLimits {
  return {
    ttlMs: coercePositiveInt(
      options?.ttlMs,
      process.env['TRACEHOUND_TRACE_ID_TTL_MS'],
      DEFAULT_TTL_MS,
    ),
    maxEntries: coercePositiveInt(
      options?.maxEntries,
      process.env['TRACEHOUND_TRACE_REGISTRY_MAX_ENTRIES'],
      DEFAULT_MAX_ENTRIES,
    ),
    maxFileBytes: coercePositiveInt(
      options?.maxFileBytes,
      process.env['TRACEHOUND_TRACE_REGISTRY_MAX_BYTES'],
      DEFAULT_MAX_FILE_BYTES,
    ),
    maxQueueEntries: coercePositiveInt(
      options?.maxQueueEntries,
      process.env['TRACEHOUND_TRACE_REGISTRY_MAX_QUEUE_ENTRIES'],
      DEFAULT_MAX_QUEUE_ENTRIES,
    ),
  }
}

function getFileBytes(path: string): number {
  if (!existsSync(path)) {
    return 0
  }

  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

function coercePositiveInt(
  fromOptions: number | undefined,
  fromEnv: string | undefined,
  fallback: number,
): number {
  if (typeof fromOptions === 'number' && Number.isFinite(fromOptions) && fromOptions > 0) {
    return Math.floor(fromOptions)
  }

  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    const parsed = Number.parseInt(fromEnv, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }

  return fallback
}

function isValidEntryInput(entry: Omit<TraceInspectionEntry, 'recordedAt'>): boolean {
  return (
    typeof entry.traceId === 'string' &&
    entry.traceId.length > 0 &&
    typeof entry.signature === 'string' &&
    entry.signature.length > 0 &&
    isSeverity(entry.severity) &&
    isNonNegativeFinite(entry.size) &&
    isNonNegativeFinite(entry.captured) &&
    typeof entry.source === 'string' &&
    entry.source.length > 0
  )
}

function isValidParsedEntry(value: Partial<TraceInspectionEntry>): value is TraceInspectionEntry {
  return (
    typeof value.traceId === 'string' &&
    value.traceId.length > 0 &&
    typeof value.signature === 'string' &&
    value.signature.length > 0 &&
    isSeverity(value.severity) &&
    isNonNegativeFinite(value.size) &&
    isNonNegativeFinite(value.captured) &&
    typeof value.source === 'string' &&
    value.source.length > 0 &&
    isNonNegativeFinite(value.recordedAt)
  )
}

function isSeverity(value: unknown): value is Severity {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'critical'
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
