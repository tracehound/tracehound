/**
 * Stats command - Show threat statistics
 */

import { getTraceRegistryStats } from '@tracehound/core'
import Table from 'cli-table3'
import { Command } from 'commander'
import { formatBytes, formatDurationMs } from '../lib/format.js'
import {
  loadSystemSnapshot,
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
      printStats(snapshotResult, stats)
    }
  })

interface ThreatStats {
  connected: boolean
  window: string
  total: number
  bySeverity: {
    critical: number
    high: number
    medium: number
    low: number
  }
  byCategory: {
    injection: number
    ddos: number
    other: number
  }
  outcomes: {
    quarantined: number
    rateLimited: number
    clean: number
    ignored: number
  }
  traceRegistry: {
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
}

function getStats(snapshotResult: CliSnapshotLoadResult, since: string): ThreatStats {
  const registry = getTraceRegistryStats()
  const fileUsagePct =
    registry.maxFileBytes > 0 ? Number(((registry.fileBytes / registry.maxFileBytes) * 100).toFixed(2)) : 0

  const base: ThreatStats = {
    connected: snapshotResult.ok,
    window: since,
    total: 0,
    bySeverity: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
    byCategory: {
      injection: 0,
      ddos: 0,
      other: 0,
    },
    outcomes: {
      quarantined: 0,
      rateLimited: 0,
      clean: 0,
      ignored: 0,
    },
    traceRegistry: {
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
    },
  }

  if (!snapshotResult.ok) {
    return base
  }

  const runtime = mapRuntimeThreatStats(snapshotResult.snapshot)

  return {
    ...base,
    total: runtime.total,
    bySeverity: runtime.bySeverity,
    byCategory: runtime.byCategory,
    outcomes: runtime.outcomes,
  }
}

function printStats(snapshotResult: CliSnapshotLoadResult, stats: ThreatStats): void {
  // Header
  console.log('\n  ╔══════════════════════════════════════════════════════════════╗')
  console.log(`  ║              THREAT STATISTICS (${stats.window.padEnd(24)})  ║`)
  console.log('  ╚══════════════════════════════════════════════════════════════╝\n')

  if (!snapshotResult.ok) {
    console.log(`  ❌ Snapshot unavailable: ${snapshotResult.code}`)
    console.log(`  Path: ${snapshotResult.path}\n`)
    printTraceRegistry(stats)
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

  printTraceRegistry(stats)
}

function printTraceRegistry(stats: ThreatStats): void {
  // Trace registry visibility (explicit data lifecycle controls)
  const registryTable = new Table({
    head: ['TRACE REGISTRY', 'Value'],
    style: { head: ['magenta'], border: ['gray'] },
  })
  registryTable.push(
    ['Path', stats.traceRegistry.path],
    ['File Exists', stats.traceRegistry.fileExists ? 'yes' : 'no'],
    ['Retained Entries', String(stats.traceRegistry.retainedEntries)],
    ['Unique Trace IDs', String(stats.traceRegistry.uniqueTraceIds)],
    [
      'Disk Usage',
      `${formatBytes(stats.traceRegistry.fileBytes)} / ${formatBytes(stats.traceRegistry.maxFileBytes)} (${stats.traceRegistry.fileUsagePct.toFixed(2)}%)`,
    ],
    [
      'Queue Depth',
      `${stats.traceRegistry.queueDepth} / ${stats.traceRegistry.maxQueueEntries}`,
    ],
    ['Dropped (in-memory)', String(stats.traceRegistry.droppedCount)],
    ['Writes Blocked', stats.traceRegistry.blocked ? 'yes' : 'no'],
    ['Retention TTL', formatDurationMs(stats.traceRegistry.ttlMs)],
    ['Read Max Entries', String(stats.traceRegistry.maxEntries)],
  )
  console.log(registryTable.toString())
  console.log()
}

function mapRuntimeThreatStats(snapshot: CliSystemSnapshot): {
  total: number
  bySeverity: ThreatStats['bySeverity']
  byCategory: ThreatStats['byCategory']
  outcomes: ThreatStats['outcomes']
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
