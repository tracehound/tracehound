/**
 * Stats command - Show threat statistics
 */

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
}

function getStats(_since: string): ThreatStats {
  // TODO: Connect to real core when available
  return {
    window: _since,
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
}
