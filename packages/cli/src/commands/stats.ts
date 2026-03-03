/**
 * Stats command - Show threat statistics
 */

import { getTraceRegistryStats } from '@tracehound/core'
import Table from 'cli-table3'
import { Command } from 'commander'

export const statsCommand = new Command('stats')
  .description('Show threat statistics')
  .option('-j, --json', 'Output as JSON')
  .option('--since <duration>', 'Time window (e.g., 1h, 24h, 7d)', '24h')
  .action((options) => {
    const stats = getStats(options.since)

    if (options.json) {
      console.log(JSON.stringify(stats, null, 2))
    } else {
      printStats(stats)
    }
  })

interface ThreatStats {
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

function getStats(since: string): ThreatStats {
  const registry = getTraceRegistryStats()
  const fileUsagePct =
    registry.maxFileBytes > 0 ? Number(((registry.fileBytes / registry.maxFileBytes) * 100).toFixed(2)) : 0

  // TODO: Threat stream counters are still pending core integration.
  return {
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
}

function printStats(stats: ThreatStats): void {
  // Header
  console.log('\n  ╔══════════════════════════════════════════════════════════════╗')
  console.log(`  ║              THREAT STATISTICS (${stats.window.padEnd(24)})  ║`)
  console.log('  ╚══════════════════════════════════════════════════════════════╝\n')

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

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function formatDurationMs(ms: number): string {
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
