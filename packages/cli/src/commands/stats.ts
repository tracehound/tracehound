/**
 * Stats command - Show threat statistics
 */

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
  console.log(`
╔════════════════════════════════════════════╗
║           THREAT STATISTICS                ║
║           Window: ${stats.window.padEnd(23)}║
╠════════════════════════════════════════════╣
║  TOTAL: ${String(stats.total).padEnd(33)}║
╠════════════════════════════════════════════╣
║  BY SEVERITY                               ║
║    🔴 Critical: ${String(stats.bySeverity.critical).padEnd(25)}║
║    🟠 High:     ${String(stats.bySeverity.high).padEnd(25)}║
║    🟡 Medium:   ${String(stats.bySeverity.medium).padEnd(25)}║
║    🟢 Low:      ${String(stats.bySeverity.low).padEnd(25)}║
╠════════════════════════════════════════════╣
║  BY CATEGORY                               ║
║    💉 Injection: ${String(stats.byCategory.injection).padEnd(24)}║
║    🌊 DDoS:      ${String(stats.byCategory.ddos).padEnd(24)}║
║    ❓ Other:     ${String(stats.byCategory.other).padEnd(24)}║
╠════════════════════════════════════════════╣
║  OUTCOMES                                  ║
║    🔒 Quarantined:  ${String(stats.outcomes.quarantined).padEnd(22)}║
║    ⏱️  Rate Limited: ${String(stats.outcomes.rateLimited).padEnd(21)}║
║    ✅ Clean:        ${String(stats.outcomes.clean).padEnd(22)}║
║    ⏭️  Ignored:      ${String(stats.outcomes.ignored).padEnd(21)}║
╚════════════════════════════════════════════╝
`)
}
