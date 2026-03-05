import * as tracehoundCore from '@tracehound/core'
import type { SnapshotReadResult, SystemSnapshot } from '@tracehound/core'

const DEFAULT_MAX_SNAPSHOT_AGE_MS = 5_000
const DEFAULT_MAX_FUTURE_SKEW_MS = 5_000
const FALLBACK_SNAPSHOT_ENV = Object.freeze({
  PATH: 'TRACEHOUND_SYSTEM_SNAPSHOT_PATH',
  SECRET: 'TRACEHOUND_SNAPSHOT_SECRET',
  MAX_AGE_MS: 'TRACEHOUND_SNAPSHOT_MAX_AGE_MS',
  MAX_FUTURE_SKEW_MS: 'TRACEHOUND_SNAPSHOT_MAX_FUTURE_SKEW_MS',
} as const)
const SNAPSHOT_ENV = tracehoundCore.SYSTEM_SNAPSHOT_ENV ?? FALLBACK_SNAPSHOT_ENV

export type CliSystemSnapshot = SystemSnapshot

export type CliSnapshotErrorCode = 'NO_INSTANCE' | 'INTEGRITY_VIOLATION'

export type CliSnapshotLoadResult =
  | {
      ok: true
      snapshot: CliSystemSnapshot
      path: string
    }
  | {
      ok: false
      code: CliSnapshotErrorCode
      path: string
    }

export function loadSystemSnapshot(): CliSnapshotLoadResult {
  const path = tracehoundCore.resolveSystemSnapshotPath()
  const secret = tracehoundCore.resolveSystemSnapshotSecret() ?? ''
  const maxSnapshotAgeMs = resolveSnapshotMaxAgeMs()
  const maxFutureSkewMs = resolveSnapshotMaxFutureSkewMs()
  const readResult = tracehoundCore.readSystemSnapshotFromDisk(path, secret)

  if (!readResult.ok) {
    return {
      ok: false,
      code: mapReadFailureToCliCode(readResult),
      path,
    }
  }

  if (isSnapshotFromFuture(readResult.snapshot.generatedAt, maxFutureSkewMs)) {
    return { ok: false, code: 'INTEGRITY_VIOLATION', path }
  }

  if (isSnapshotStale(readResult.snapshot.generatedAt, maxSnapshotAgeMs)) {
    return { ok: false, code: 'NO_INSTANCE', path }
  }

  return {
    ok: true,
    snapshot: readResult.snapshot,
    path,
  }
}

function resolveSnapshotMaxAgeMs(): number {
  const raw = process.env[SNAPSHOT_ENV.MAX_AGE_MS]
  if (typeof raw !== 'string' || raw.length === 0) {
    return DEFAULT_MAX_SNAPSHOT_AGE_MS
  }

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_SNAPSHOT_AGE_MS
  }

  return Math.floor(parsed)
}

function resolveSnapshotMaxFutureSkewMs(): number {
  const raw = process.env[SNAPSHOT_ENV.MAX_FUTURE_SKEW_MS]
  if (typeof raw !== 'string' || raw.length === 0) {
    return DEFAULT_MAX_FUTURE_SKEW_MS
  }

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_MAX_FUTURE_SKEW_MS
  }

  return Math.floor(parsed)
}

function isSnapshotStale(generatedAt: number, maxAgeMs: number): boolean {
  return Date.now() - generatedAt > maxAgeMs
}

function isSnapshotFromFuture(generatedAt: number, maxFutureSkewMs: number): boolean {
  return generatedAt - Date.now() > maxFutureSkewMs
}

function mapReadFailureToCliCode(
  result: Extract<SnapshotReadResult, { ok: false }>,
): CliSnapshotErrorCode {
  if (result.reason === 'NO_INSTANCE') {
    return 'NO_INSTANCE'
  }

  return 'INTEGRITY_VIOLATION'
}
