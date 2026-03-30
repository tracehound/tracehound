/**
 * Metrics collector for the soak harness.
 *
 * Samples process memory and Tracehound runtime state at a fixed interval,
 * prints a human-readable status line to stdout, and appends a structured
 * JSONL record to logs/metrics.jsonl for offline analysis.
 */

import type { ITracehound } from '@tracehound/core'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TrafficCounters } from './traffic.js'

// ─────────────────────────────────────────────────────────────────────────────
// Paths
// ─────────────────────────────────────────────────────────────────────────────

const PKG_ROOT = join(fileURLToPath(import.meta.url), '..', '..') // infrastructure/soak/
const LOGS_DIR = join(PKG_ROOT, 'logs')
const METRICS_FILE = join(LOGS_DIR, 'metrics.jsonl')

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface MemorySample {
  heapUsedMb: number
  heapTotalMb: number
  rssMb: number
  externalMb: number
}

interface MetricsSample {
  ts: number
  uptimeS: number
  memory: MemorySample
  agent: {
    total: number
    clean: number
    quarantined: number
    rateLimited: number
    ignored: number
    errors: number
    validationFailures: number
  }
  quarantine: {
    count: number
    bytes: number
    decayed: number
    evicted: number
    archived: number
  }
  watcher: {
    totalAlerts: number
    alertsInWindow: number
    overloaded: boolean
    pressureMode: string
    archiveSuppressed: boolean
    houndPressureEvents: number
  }
  traffic: {
    total: number
    sent: number
    errors: number
    status200: number
    status403: number
    status413: number
    status429: number
    status500: number
    realisticUserTotal: number
    falsePositive429: number
    falsePositive403: number
    traceHeadersOn403: number
    missingTraceHeadersOn403: number
  }
}

export interface MetricsCollector {
  start(): void
  stop(): void
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function toMb(bytes: number): number {
  return Math.round((bytes / 1_048_576) * 10) / 10
}

function pad(n: number, width: number = 6): string {
  return String(n).padStart(width, ' ')
}

function renderStatus(sample: MetricsSample): string {
  const ts = new Date(sample.ts).toISOString()
  const mem = `heap=${sample.memory.heapUsedMb}/${sample.memory.heapTotalMb}MB rss=${sample.memory.rssMb}MB`
  const agt = `total=${pad(sample.agent.total)} clean=${pad(sample.agent.clean)} quar=${pad(sample.agent.quarantined)} ign=${pad(sample.agent.ignored)} rl=${pad(sample.agent.rateLimited)} vf=${pad(sample.agent.validationFailures, 4)} err=${pad(sample.agent.errors, 4)}`
  const qua = `Q[${sample.quarantine.count} items / ${toMb(sample.quarantine.bytes)}MB decay=${sample.quarantine.decayed}]`
  const wtc = `W[alerts=${sample.watcher.totalAlerts} win=${sample.watcher.alertsInWindow}${sample.watcher.overloaded ? ' OVERLOAD' : ''}]`
  const pressure = `P[mode=${sample.watcher.pressureMode} archive=${sample.watcher.archiveSuppressed ? 'suppressed' : 'active'} hound=${sample.watcher.houndPressureEvents}]`
  const trf = `tx=${sample.traffic.total} ok=${sample.traffic.status200} 403=${sample.traffic.status403} 413=${sample.traffic.status413} 429=${sample.traffic.status429} 5xx=${sample.traffic.status500} tErr=${sample.traffic.errors}`
  const fp = `FP[429=${sample.traffic.falsePositive429} 403=${sample.traffic.falsePositive403} trace403=${sample.traffic.traceHeadersOn403}/${sample.traffic.missingTraceHeadersOn403} realUsr=${sample.traffic.realisticUserTotal}]`

  return `[${ts}] uptime=${sample.uptimeS}s ${mem} | ${agt} | ${qua} | ${wtc} | ${pressure} | ${trf} | ${fp}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createMetricsCollector(
  th: ITracehound,
  trafficCounters: TrafficCounters,
  intervalMs: number = 5_000,
): MetricsCollector {
  mkdirSync(LOGS_DIR, { recursive: true })

  const startedAt = Date.now()
  let timerId: NodeJS.Timeout | null = null

  function sample(): void {
    const now = Date.now()
    const mem = process.memoryUsage()
    const snap = th.snapshot()

    const s: MetricsSample = {
      ts: now,
      uptimeS: Math.floor((now - startedAt) / 1_000),
      memory: {
        heapUsedMb: toMb(mem.heapUsed),
        heapTotalMb: toMb(mem.heapTotal),
        rssMb: toMb(mem.rss),
        externalMb: toMb(mem.external),
      },
      agent: {
        total: snap.agent.totalIntercepts,
        clean: snap.agent.cleanCount,
        quarantined: snap.agent.quarantinedCount,
        rateLimited: snap.agent.rateLimitedCount,
        ignored: snap.agent.ignoredCount,
        errors: snap.agent.errorCount,
        validationFailures: snap.agent.validationFailures,
      },
      quarantine: {
        count: snap.quarantine.count,
        bytes: snap.quarantine.bytes,
        decayed: snap.quarantine.decayedCount,
        evicted: snap.quarantine.evictedCount,
        archived: snap.quarantine.archivedCount,
      },
      watcher: {
        totalAlerts: snap.watcher.totalAlerts,
        alertsInWindow: snap.watcher.alertsInWindow,
        overloaded: snap.watcher.overloaded,
        pressureMode: snap.pressure.mode,
        archiveSuppressed: snap.pressure.archiveSuppressed,
        houndPressureEvents: snap.pressure.signals.houndPressureEvents,
      },
      traffic: {
        total: trafficCounters.total,
        sent: trafficCounters.sent,
        errors: trafficCounters.errors,
        status200: trafficCounters.byStatus.get(200) ?? 0,
        status403: trafficCounters.byStatus.get(403) ?? 0,
        status413: trafficCounters.byStatus.get(413) ?? 0,
        status429: trafficCounters.byStatus.get(429) ?? 0,
        status500: trafficCounters.byStatus.get(500) ?? 0,
        realisticUserTotal: trafficCounters.byLane.realistic_user,
        falsePositive429: trafficCounters.falsePositive429,
        falsePositive403: trafficCounters.falsePositive403,
        traceHeadersOn403: trafficCounters.traceHeadersOn403,
        missingTraceHeadersOn403: trafficCounters.missingTraceHeadersOn403,
      },
    }

    // Human-readable stdout
    process.stdout.write(renderStatus(s) + '\n')

    // Structured JSONL append — suitable for grep / jq analysis; best-effort
    try {
      appendFileSync(METRICS_FILE, JSON.stringify(s) + '\n', 'utf8')
    } catch {
      // Non-fatal: metrics loss is preferable to crashing the soak run
    }
  }

  return {
    start(): void {
      if (timerId !== null) return
      process.stdout.write(`[soak] metrics → ${METRICS_FILE}\n`)
      sample() // immediate first sample
      timerId = setInterval(sample, intervalMs)
    },

    stop(): void {
      if (timerId === null) return
      clearInterval(timerId)
      timerId = null
      sample() // final sample on shutdown
    },
  }
}
