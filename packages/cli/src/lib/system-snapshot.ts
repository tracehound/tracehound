import {
  readSystemSnapshotFromDisk,
  resolveSystemSnapshotPath,
  resolveSystemSnapshotSecret,
  SYSTEM_SNAPSHOT_ENV,
  type SnapshotReadResult,
  type SystemSnapshot,
} from '@tracehound/core'

const DEFAULT_MAX_SNAPSHOT_AGE_MS = 5_000
const DEFAULT_MAX_FUTURE_SKEW_MS = 5_000
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

interface LoadSystemSnapshotOptions {
  /**
   * Injectable clock returning current time in ms.
   * DEFAULT: Date.now.
   * @internal For deterministic testing only.
   */
  _now?: () => number
}

function resolveNow(now?: () => number): () => number {
  // eslint-disable-next-line no-restricted-syntax -- CLI bridge defers to global Date.now so fake timers remain effective
  return now ?? ((): number => Date.now())
}

export function loadSystemSnapshot(options: LoadSystemSnapshotOptions = {}): CliSnapshotLoadResult {
  const now = resolveNow(options._now)
  const path = resolveSystemSnapshotPath()
  const secret = resolveSystemSnapshotSecret() ?? ''
  const maxSnapshotAgeMs = resolveSnapshotMaxAgeMs()
  const maxFutureSkewMs = resolveSnapshotMaxFutureSkewMs()
  const readResult = readSystemSnapshotFromDisk(path, secret)

  if (!readResult.ok) {
    return {
      ok: false,
      code: mapReadFailureToCliCode(readResult),
      path,
    }
  }

  if (isSnapshotFromFuture(readResult.snapshot.generatedAt, maxFutureSkewMs, now)) {
    return { ok: false, code: 'INTEGRITY_VIOLATION', path }
  }

  if (isSnapshotStale(readResult.snapshot.generatedAt, maxSnapshotAgeMs, now)) {
    return { ok: false, code: 'NO_INSTANCE', path }
  }

  return {
    ok: true,
    snapshot: readResult.snapshot,
    path,
  }
}

function resolveSnapshotMaxAgeMs(): number {
  const raw = process.env[SYSTEM_SNAPSHOT_ENV.MAX_AGE_MS]
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
  const raw = process.env[SYSTEM_SNAPSHOT_ENV.MAX_FUTURE_SKEW_MS]
  if (typeof raw !== 'string' || raw.length === 0) {
    return DEFAULT_MAX_FUTURE_SKEW_MS
  }

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_MAX_FUTURE_SKEW_MS
  }

  return Math.floor(parsed)
}

function isSnapshotStale(generatedAt: number, maxAgeMs: number, now: () => number): boolean {
  return now() - generatedAt > maxAgeMs
}

function isSnapshotFromFuture(
  generatedAt: number,
  maxFutureSkewMs: number,
  now: () => number,
): boolean {
  return generatedAt - now() > maxFutureSkewMs
}

function mapReadFailureToCliCode(
  result: Extract<SnapshotReadResult, { ok: false }>,
): CliSnapshotErrorCode {
  if (result.reason === 'NO_INSTANCE') {
    return 'NO_INSTANCE'
  }

  return 'INTEGRITY_VIOLATION'
}
