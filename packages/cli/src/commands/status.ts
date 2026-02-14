/**
 * Status command - Show current system status
 */

import Table from 'cli-table3'
import { Command } from 'commander'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { version } = require('../../package.json')

export const statusCommand = new Command('status')
  .description('Show current Tracehound system status')
  .option('-j, --json', 'Output as JSON')
  .action((options) => {
    const status = getSystemStatus()

    if (options.json) {
      console.log(JSON.stringify(status, null, 2))
    } else {
      printStatus(status)
    }
  })

interface SystemStatus {
  version: string
  uptime: number
  health: 'healthy' | 'degraded' | 'critical'
  quarantine: {
    count: number
    bytes: number
    capacity: number
  }
  rateLimit: {
    blocked: number
    active: number
  }
  houndPool: {
    active: number
    dormant: number
    total: number
  }
}

function getSystemStatus(): SystemStatus {
  // TODO: Connect to real core when available
  return {
    version: version,
    uptime: Math.floor(process.uptime()),
    health: 'healthy',
    quarantine: {
      count: 0,
      bytes: 0,
      capacity: 1000,
    },
    rateLimit: {
      blocked: 0,
      active: 0,
    },
    houndPool: {
      active: 0,
      dormant: 0,
      total: 0,
    },
  }
}

function printStatus(status: SystemStatus): void {
  const healthIcon = status.health === 'healthy' ? '✅' : status.health === 'degraded' ? '⚠️' : '🔴'

  // Header
  console.log('\n  ╔══════════════════════════════════════════════════════════════╗')
  console.log('  ║                    TRACEHOUND STATUS                         ║')
  console.log('  ╚══════════════════════════════════════════════════════════════╝\n')

  // System Info Table
  const systemTable = new Table({
    head: ['Property', 'Value'],
    style: { head: ['cyan'], border: ['gray'] },
  })
  systemTable.push(
    ['Version', status.version],
    ['Uptime', formatUptime(status.uptime)],
    ['Health', `${healthIcon} ${status.health}`],
  )
  console.log(systemTable.toString())
  console.log()

  // Quarantine Table
  const quarantineTable = new Table({
    head: ['QUARANTINE', 'Value'],
    style: { head: ['yellow'], border: ['gray'] },
  })
  const usage =
    status.quarantine.capacity > 0
      ? ((status.quarantine.count / status.quarantine.capacity) * 100).toFixed(1)
      : '0.0'
  quarantineTable.push(
    ['Count', `${status.quarantine.count} / ${status.quarantine.capacity}`],
    ['Usage', `${usage}%`],
    ['Bytes', formatBytes(status.quarantine.bytes)],
  )
  console.log(quarantineTable.toString())
  console.log()

  // Rate Limit Table
  const rateLimitTable = new Table({
    head: ['RATE LIMIT', 'Value'],
    style: { head: ['magenta'], border: ['gray'] },
  })
  rateLimitTable.push(
    ['Blocked', String(status.rateLimit.blocked)],
    ['Active', String(status.rateLimit.active)],
  )
  console.log(rateLimitTable.toString())
  console.log()

  // Hound Pool Table
  const poolTable = new Table({
    head: ['HOUND POOL', 'Value'],
    style: { head: ['green'], border: ['gray'] },
  })
  poolTable.push(
    ['Active', String(status.houndPool.active)],
    ['Dormant', String(status.houndPool.dormant)],
    ['Total', String(status.houndPool.total)],
  )
  console.log(poolTable.toString())
  console.log()
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h}h ${m}m ${s}s`
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}
