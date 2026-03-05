/**
 * Stats command - Show threat statistics
 */

import { getTraceRegistryStats } from '@tracehound/core'
import Table from 'cli-table3'
import { Command } from 'commander'
import { formatBytes, formatDurationMs } from '../lib/format.js'
import {
  loadSystemSnapshot,
  type CliSnapshotErrorCode,
  type CliSnapshotLoadResult,
  type CliSystemSnapshot,
} from '../lib/system-snapshot.js'

export const statsCommand = new Command('stats')
  .description('Show threat statistics')
  .option('-j, --json', 'Output as JSON')
  .option('--since <duration>', 'Time window (e.g., 1h, 24h, 7d)', '24h')
  .action((options) => {
    const snapshotResult = loadSystemSnapshot()
    const stats = getStats(snapshotResult, options.since)

    if (options.json) {
      console.log(JSON.stringify(stats, null, 2))
    } else {
      printStats(stats)
    }
  })

interface ThreatSeverityStats {
  critical: number
  high: number
  medium: number
  low: number
}

interface ThreatCategoryStats {
  injection: number
  ddos: number
  other: number
}

interface ThreatOutcomeStats {
  quarantined: number
  rateLimited: number
  clean: number
  ignored: number
}

interface TraceRegistrySnapshot {
  path: string
  fileExists: boolean
  retainedEntries: number
  uniqueTraceIds: number
  fileBytes: number
  maxFileBytes: number
  fileUsagePct: number
  queueDepth: number
  maxQueueEntries: number
  droppedCount: number
  blocked: boolean
  ttlMs: number
  maxEntries: number
}

interface ConnectedThreatStats {
  connected: true
  window: string
  total: number
  bySeverity: ThreatSeverityStats
  byCategory: ThreatCategoryStats
  outcomes: ThreatOutcomeStats
  traceRegistry: TraceRegistrySnapshot
}

interface DisconnectedThreatStats {
  connected: false
  window: string
  error: CliSnapshotErrorCode
  path: string
  traceRegistry: TraceRegistrySnapshot
}

type ThreatStats = ConnectedThreatStats | DisconnectedThreatStats

function getTraceRegistrySnapshot(): TraceRegistrySnapshot {
  const registry = getTraceRegistryStats()
  const fileUsagePct =
    registry.maxFileBytes > 0 ? Number(((registry.fileBytes / registry.maxFileBytes) * 100).toFixed(2)) : 0

  return {
    path: registry.path,
    fileExists: registry.fileExists,
    retainedEntries: registry.retainedEntries,
    uniqueTraceIds: registry.uniqueTraceIds,
    fileBytes: registry.fileBytes,
    maxFileBytes: registry.maxFileBytes,
    fileUsagePct,
    queueDepth: registry.queueDepth,
    maxQueueEntries: registry.maxQueueEntries,
    droppedCount: registry.droppedCount,
    blocked: registry.blocked,
    ttlMs: registry.ttlMs,
    maxEntries: registry.maxEntries,
  }
}

function getStats(snapshotResult: CliSnapshotLoadResult, since: string): ThreatStats {
  const traceRegistry = getTraceRegistrySnapshot()

  if (!snapshotResult.ok) {
    return {
      connected: false,
      error: snapshotResult.code,
      path: snapshotResult.path,
      window: since,
      traceRegistry,
    }
  }

  const runtime = mapRuntimeThreatStats(snapshotResult.snapshot)

  return {
    connected: true,
    window: since,
    total: runtime.total,
    bySeverity: runtime.bySeverity,
    byCategory: runtime.byCategory,
    outcomes: runtime.outcomes,
    traceRegistry,
  }
}

function printStats(stats: ThreatStats): void {
  // Header
  console.log('\n  ╔══════════════════════════════════════════════════════════════╗')
  console.log(`  ║              THREAT STATISTICS (${stats.window.padEnd(24)})  ║`)
  console.log('  ╚══════════════════════════════════════════════════════════════╝\n')

  if (!stats.connected) {
    console.log(`  ❌ Snapshot unavailable: ${stats.error}`)
    console.log(`  Path: ${stats.path}\n`)
    printTraceRegistry(stats.traceRegistry)
    return
  }

  // Summary
  const summaryTable = new Table({
    head: ['Metric', 'Value'],
    style: { head: ['cyan'], border: ['gray'] },
  })
  summaryTable.push(['Total Threats', String(stats.total)], ['Time Window', stats.window])
  console.log(summaryTable.toString())
  console.log()

  // By Severity
  const severityTable = new Table({
    head: ['Severity', 'Count'],
    style: { head: ['red'], border: ['gray'] },
  })
  severityTable.push(
    ['🔴 Critical', String(stats.bySeverity.critical)],
    ['🟠 High', String(stats.bySeverity.high)],
    ['🟡 Medium', String(stats.bySeverity.medium)],
    ['🟢 Low', String(stats.bySeverity.low)]
  )
  console.log(severityTable.toString())
  console.log()

  // By Category
  const categoryTable = new Table({
    head: ['Category', 'Count'],
    style: { head: ['yellow'], border: ['gray'] },
  })
  categoryTable.push(
    ['💉 Injection', String(stats.byCategory.injection)],
    ['🌊 DDoS', String(stats.byCategory.ddos)],
    ['❓ Other', String(stats.byCategory.other)]
  )
  console.log(categoryTable.toString())
  console.log()

  // Outcomes
  const outcomesTable = new Table({
    head: ['Outcome', 'Count'],
    style: { head: ['green'], border: ['gray'] },
  })
  outcomesTable.push(
    ['🔒 Quarantined', String(stats.outcomes.quarantined)],
    ['⏱️  Rate Limited', String(stats.outcomes.rateLimited)],
    ['✅ Clean', String(stats.outcomes.clean)],
    ['⏭️  Ignored', String(stats.outcomes.ignored)]
  )
  console.log(outcomesTable.toString())
  console.log()

  printTraceRegistry(stats.traceRegistry)
}

function printTraceRegistry(traceRegistry: TraceRegistrySnapshot): void {
  // Trace registry visibility (explicit data lifecycle controls)
  const registryTable = new Table({
    head: ['TRACE REGISTRY', 'Value'],
    style: { head: ['magenta'], border: ['gray'] },
  })
  registryTable.push(
    ['Path', traceRegistry.path],
    ['File Exists', traceRegistry.fileExists ? 'yes' : 'no'],
    ['Retained Entries', String(traceRegistry.retainedEntries)],
    ['Unique Trace IDs', String(traceRegistry.uniqueTraceIds)],
    [
      'Disk Usage',
      `${formatBytes(traceRegistry.fileBytes)} / ${formatBytes(traceRegistry.maxFileBytes)} (${traceRegistry.fileUsagePct.toFixed(2)}%)`,
    ],
    [
      'Queue Depth',
      `${traceRegistry.queueDepth} / ${traceRegistry.maxQueueEntries}`,
    ],
    ['Dropped (in-memory)', String(traceRegistry.droppedCount)],
    ['Writes Blocked', traceRegistry.blocked ? 'yes' : 'no'],
    ['Retention TTL', formatDurationMs(traceRegistry.ttlMs)],
    ['Read Max Entries', String(traceRegistry.maxEntries)],
  )
  console.log(registryTable.toString())
  console.log()
}

function mapRuntimeThreatStats(snapshot: CliSystemSnapshot): {
  total: number
  bySeverity: ThreatSeverityStats
  byCategory: ThreatCategoryStats
  outcomes: ThreatOutcomeStats
} {
  const byCategory = snapshot.watcher.threats.byCategory
  const injection = byCategory['injection'] ?? 0
  const ddos = byCategory['ddos'] ?? 0
  const known = injection + ddos
  const other = Math.max(0, snapshot.watcher.threats.total - known)

  return {
    total: snapshot.watcher.threats.total,
    bySeverity: {
      critical: snapshot.watcher.threats.bySeverity.critical,
      high: snapshot.watcher.threats.bySeverity.high,
      medium: snapshot.watcher.threats.bySeverity.medium,
      low: snapshot.watcher.threats.bySeverity.low,
    },
    byCategory: {
      injection,
      ddos,
      other,
    },
    outcomes: {
      quarantined: snapshot.agent.quarantinedCount,
      rateLimited: snapshot.agent.rateLimitedCount,
      clean: snapshot.agent.cleanCount,
      ignored: snapshot.agent.ignoredCount,
    },
  }
}
