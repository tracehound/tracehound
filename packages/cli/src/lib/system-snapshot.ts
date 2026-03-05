import {
  readSystemSnapshotFromDisk,
  resolveSystemSnapshotPath,
  resolveSystemSnapshotSecret,
  type SnapshotReadResult,
  type SystemSnapshot,
} from '@tracehound/core'

const DEFAULT_MAX_SNAPSHOT_AGE_MS = 5_000

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
  const path = resolveSystemSnapshotPath()
  const secret = resolveSystemSnapshotSecret() ?? ''
  const maxSnapshotAgeMs = resolveSnapshotMaxAgeMs()
  const readResult = readSystemSnapshotFromDisk(path, secret)

  if (!readResult.ok) {
    return {
      ok: false,
      code: mapReadFailureToCliCode(readResult),
      path,
    }
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
  const raw = process.env.TRACEHOUND_SNAPSHOT_MAX_AGE_MS
  if (typeof raw !== 'string' || raw.length === 0) {
    return DEFAULT_MAX_SNAPSHOT_AGE_MS
  }

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_SNAPSHOT_AGE_MS
  }

  return Math.floor(parsed)
}

function isSnapshotStale(generatedAt: number, maxAgeMs: number): boolean {
  return Date.now() - generatedAt > maxAgeMs
}

function mapReadFailureToCliCode(
  result: Extract<SnapshotReadResult, { ok: false }>,
): CliSnapshotErrorCode {
  if (result.reason === 'NO_INSTANCE') {
    return 'NO_INSTANCE'
  }

  return 'INTEGRITY_VIOLATION'
}
