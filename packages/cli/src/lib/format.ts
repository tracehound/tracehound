/**
 * Formatting utilities for CLI output.
 */

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`
  }

  const seconds = Math.floor(ms / 1000)
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) {
    return `${days}d ${hours}h`
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  if (minutes > 0) {
    return `${minutes}m`
  }

  return `${seconds}s`
}

// ── Dashboard-oriented format helpers (used by watch screen renderers) ─────

/** Alias for formatBytes — same implementation, dashboard naming convention. */
export const fmtBytes = formatBytes

/** Format a number with locale thousands separators. */
export function fmtCount(n: number): string {
  return n.toLocaleString('en-US')
}

/** Format milliseconds as a compact duration including minutes at day level. */
export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}

/** Format total seconds as a human-readable uptime string. */
export function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/**
 * Format a past timestamp as a relative "N ago" string.
 * `now` is injectable for deterministic tests.
 */
export function fmtAgo(ts: number, now: number = Date.now()): string {
  const diff = now - ts
  if (diff <= 0) return 'just now'
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3_600_000)}h ago`
}

/** Convert a status string to a normalized uppercase display label. */
export function fmtStatus(s: string): string {
  return s.toUpperCase()
}
