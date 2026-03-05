/**
 * System snapshot export/read utilities.
 *
 * SECURITY:
 * - Snapshot payload is HMAC-SHA256 signed.
 * - Signature is verified with constant-time comparison.
 * - Writes are atomic (.tmp + rename).
 * - POSIX permissions are set to owner-only best-effort (0600).
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHmac } from 'node:crypto'
import type { AgentStats } from '../core/agent.js'
import type { HoundPoolStats } from '../core/hound-pool.js'
import type { QuarantineStats } from '../core/quarantine.js'
import type { RateLimiterStats } from '../core/rate-limiter.js'
import type { ITracehound } from '../core/tracehound.js'
import type { WatcherSnapshot } from '../core/watcher.js'
import { Errors } from '../types/errors.js'
import { constantTimeEqual } from './compare.js'

export type SystemHealth = 'healthy' | 'degraded' | 'critical'

export interface SystemSnapshot {
  generatedAt: number
  systemHealth: SystemHealth
  agent: Readonly<AgentStats>
  quarantine: Readonly<QuarantineStats>
  quarantineMaxBytes: number
  watcher: Readonly<WatcherSnapshot>
  houndPool: Readonly<HoundPoolStats>
  rateLimiter: Readonly<RateLimiterStats>
}

interface SignedSystemSnapshot {
  version: 1
  algorithm: 'HMAC-SHA256'
  payload: SystemSnapshot
  signature: string
}

export type SnapshotReadResult =
  | { ok: true; snapshot: SystemSnapshot }
  | { ok: false; reason: 'NO_INSTANCE' | 'INTEGRITY_VIOLATION' | 'INVALID_FORMAT' | 'IO_ERROR' }

const DEFAULT_SNAPSHOT_PATH = join(tmpdir(), 'tracehound', 'system-snapshot.json')
let windowsAclWarningEmitted = false

/**
 * Resolve snapshot path from explicit path, env, or default.
 */
export function resolveSystemSnapshotPath(pathOverride?: string): string {
  if (typeof pathOverride === 'string' && pathOverride.length > 0) {
    return pathOverride
  }

  const fromEnv = process.env['TRACEHOUND_SYSTEM_SNAPSHOT_PATH']
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    return fromEnv
  }

  return DEFAULT_SNAPSHOT_PATH
}

/**
 * Resolve snapshot secret from explicit value or env.
 */
export function resolveSystemSnapshotSecret(secretOverride?: string): string | null {
  if (typeof secretOverride === 'string' && secretOverride.length > 0) {
    return secretOverride
  }

  const fromEnv = process.env['TRACEHOUND_SNAPSHOT_SECRET']
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    return fromEnv
  }

  return null
}

/**
 * Export immutable runtime snapshot from a live Tracehound instance.
 */
export function exportSystemSnapshot(tracehound: ITracehound): SystemSnapshot {
  const watcher = tracehound.watcher.snapshot()
  const pool = tracehound.houndPool.stats

  const systemHealth: SystemHealth = deriveSystemHealth(watcher, pool)

  return Object.freeze({
    generatedAt: Date.now(),
    systemHealth,
    agent: tracehound.agent.getStats(),
    quarantine: tracehound.quarantine.stats,
    quarantineMaxBytes: tracehound.quarantine.maxBytes,
    watcher,
    houndPool: pool,
    rateLimiter: tracehound.rateLimiter.stats,
  })
}

/**
 * Write signed snapshot to disk atomically.
 */
export function writeSystemSnapshotToDisk(snapshot: SystemSnapshot, path: string, secret: string): void {
  if (secret.length === 0) {
    throw Errors.snapshotSecretMissing()
  }

  const payloadText = JSON.stringify(snapshot)
  const signed: SignedSystemSnapshot = {
    version: 1,
    algorithm: 'HMAC-SHA256',
    payload: snapshot,
    signature: signPayload(payloadText, secret),
  }
  const signedText = JSON.stringify(signed)

  const parent = dirname(path)
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`

  try {
    mkdirSync(parent, { recursive: true })
    writeFileSync(tmpPath, signedText, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'w',
    })
    renameSync(tmpPath, path)

    if (process.platform !== 'win32') {
      try {
        chmodSync(path, 0o600)
      } catch {
        // Best-effort only. Not fatal for fail-open semantics.
      }
    } else if (!windowsAclWarningEmitted) {
      windowsAclWarningEmitted = true
      process.emitWarning(
        'Tracehound snapshot file ACL hardening is best-effort on Windows. Configure ACLs externally for strict isolation.',
      )
    }
  } catch (error: unknown) {
    try {
      if (existsSync(tmpPath)) {
        unlinkSync(tmpPath)
      }
    } catch {
      // Ignore temp cleanup errors.
    }
    const reason = error instanceof Error ? error.message : 'unknown'
    throw Errors.snapshotWriteFailed(reason)
  }
}

/**
 * Read and verify snapshot from disk.
 */
export function readSystemSnapshotFromDisk(path: string, secret: string): SnapshotReadResult {
  if (!existsSync(path)) {
    return { ok: false, reason: 'NO_INSTANCE' }
  }

  if (secret.length === 0) {
    return { ok: false, reason: 'INTEGRITY_VIOLATION' }
  }

  try {
    const text = readFileSync(path, 'utf8')
    const parsed = JSON.parse(text) as unknown
    if (!isSignedSnapshot(parsed)) {
      return { ok: false, reason: 'INVALID_FORMAT' }
    }

    const payloadText = JSON.stringify(parsed.payload)
    const expected = signPayload(payloadText, secret)
    if (!constantTimeEqual(expected, parsed.signature)) {
      return { ok: false, reason: 'INTEGRITY_VIOLATION' }
    }

    return { ok: true, snapshot: parsed.payload }
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error) {
      return { ok: false, reason: 'IO_ERROR' }
    }
    return { ok: false, reason: 'INVALID_FORMAT' }
  }
}

function signPayload(payloadText: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadText).digest('hex')
}

function deriveSystemHealth(
  watcher: Readonly<WatcherSnapshot>,
  pool: Readonly<HoundPoolStats>,
): SystemHealth {
  if (watcher.overloaded) {
    return 'critical'
  }

  if (pool.totalProcesses > 0 && pool.activeProcesses >= pool.totalProcesses) {
    return 'critical'
  }

  if (watcher.alertsInWindow > 0) {
    return 'degraded'
  }

  return 'healthy'
}

function isSignedSnapshot(value: unknown): value is SignedSystemSnapshot {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<SignedSystemSnapshot>
  if (candidate.version !== 1) {
    return false
  }
  if (candidate.algorithm !== 'HMAC-SHA256') {
    return false
  }
  if (typeof candidate.signature !== 'string' || candidate.signature.length === 0) {
    return false
  }
  if (!isSystemSnapshot(candidate.payload)) {
    return false
  }

  return true
}

function isSystemSnapshot(value: unknown): value is SystemSnapshot {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const snapshot = value as Partial<SystemSnapshot>
  if (typeof snapshot.generatedAt !== 'number' || !Number.isFinite(snapshot.generatedAt)) {
    return false
  }
  if (
    snapshot.systemHealth !== 'healthy' &&
    snapshot.systemHealth !== 'degraded' &&
    snapshot.systemHealth !== 'critical'
  ) {
    return false
  }
  if (typeof snapshot.quarantineMaxBytes !== 'number' || snapshot.quarantineMaxBytes < 0) {
    return false
  }
  if (!snapshot.agent || !snapshot.quarantine || !snapshot.watcher || !snapshot.houndPool) {
    return false
  }
  if (!snapshot.rateLimiter) {
    return false
  }

  return true
}
