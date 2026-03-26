/**
 * Status command - Show current system status
 */

import Table from 'cli-table3'
import { Command } from 'commander'
import {
  loadSystemSnapshot,
  type CliSnapshotLoadResult,
  type CliSystemSnapshot,
} from '../lib/system-snapshot.js'

export const statusCommand = new Command('status')
  .description('Show current Tracehound system status')
  .option('-j, --json', 'Output as JSON')
  .action((options) => {
    const snapshotResult = loadSystemSnapshot()

    if (options.json) {
      console.log(JSON.stringify(toJsonOutput(snapshotResult), null, 2))
    } else {
      printStatus(snapshotResult)
    }
  })

interface SystemStatus {
  uptime: number
  health: CliSystemSnapshot['systemHealth']
  pressure: {
    mode: CliSystemSnapshot['pressure']['mode']
    archiveSuppressed: boolean
    capacityPercent: number
    droppedEvents: number
    archiveFailureCount: number
    houndPressureEvents: number
  }
  quarantine: {
    count: number
    bytes: number
    maxBytes: number
  }
  rateLimit: {
    blocked: number
    sources: number
  }
  houndPool: {
    active: number
    dormant: number
    total: number
  }
}

function getSystemStatus(snapshot: CliSystemSnapshot): SystemStatus {
  const total = snapshot.houndPool.totalProcesses

  return {
    uptime: Math.floor(snapshot.watcher.uptimeMs / 1000),
    health: snapshot.systemHealth,
    pressure: {
      mode: snapshot.pressure.mode,
      archiveSuppressed: snapshot.pressure.archiveSuppressed,
      capacityPercent: snapshot.pressure.signals.quarantineCapacityPercent,
      droppedEvents: snapshot.pressure.signals.droppedEvents,
      archiveFailureCount: snapshot.pressure.signals.archiveFailureCount,
      houndPressureEvents: snapshot.pressure.signals.houndPressureEvents,
    },
    quarantine: {
      count: snapshot.quarantine.count,
      bytes: snapshot.quarantine.bytes,
      maxBytes: snapshot.quarantineMaxBytes,
    },
    rateLimit: {
      blocked: snapshot.rateLimiter.blocked,
      sources: snapshot.rateLimiter.sources,
    },
    houndPool: {
      active: snapshot.houndPool.activeProcesses,
      dormant: Math.max(0, total - snapshot.houndPool.activeProcesses),
      total,
    },
  }
}

function printStatus(snapshotResult: CliSnapshotLoadResult): void {
  if (!snapshotResult.ok) {
    printSnapshotError(snapshotResult)
    return
  }

  const status = getSystemStatus(snapshotResult.snapshot)
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
    ['Snapshot', new Date(snapshotResult.snapshot.generatedAt).toISOString()],
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
    status.quarantine.maxBytes > 0
      ? ((status.quarantine.bytes / status.quarantine.maxBytes) * 100).toFixed(1)
      : '0.0'
  quarantineTable.push(
    ['Count', String(status.quarantine.count)],
    ['Usage', `${usage}%`],
    [
      'Bytes',
      `${formatBytes(status.quarantine.bytes)} / ${formatBytes(status.quarantine.maxBytes)}`,
    ],
  )
  console.log(quarantineTable.toString())
  console.log()

  const pressureTable = new Table({
    head: ['PRESSURE', 'Value'],
    style: { head: ['red'], border: ['gray'] },
  })
  pressureTable.push(
    ['Mode', status.pressure.mode],
    ['Archive', status.pressure.archiveSuppressed ? 'suppressed' : 'active'],
    ['Capacity', `${status.pressure.capacityPercent.toFixed(1)}%`],
    ['Drops', String(status.pressure.droppedEvents)],
    ['Hound Pressure', String(status.pressure.houndPressureEvents)],
  )
  console.log(pressureTable.toString())
  console.log()

  // Rate Limit Table
  const rateLimitTable = new Table({
    head: ['RATE LIMIT', 'Value'],
    style: { head: ['magenta'], border: ['gray'] },
  })
  rateLimitTable.push(
    ['Blocked', String(status.rateLimit.blocked)],
    ['Tracked Sources', String(status.rateLimit.sources)],
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

function printSnapshotError(snapshotResult: Extract<CliSnapshotLoadResult, { ok: false }>): void {
  console.log('\n  ╔══════════════════════════════════════════════════════════════╗')
  console.log('  ║                    TRACEHOUND STATUS                         ║')
  console.log('  ╚══════════════════════════════════════════════════════════════╝\n')
  console.log(`  ❌ Snapshot unavailable: ${snapshotResult.code}`)
  console.log(`  Path: ${snapshotResult.path}`)
  console.log()
}

function toJsonOutput(snapshotResult: CliSnapshotLoadResult): unknown {
  if (!snapshotResult.ok) {
    return {
      connected: false,
      error: snapshotResult.code,
      path: snapshotResult.path,
    }
  }

  return {
    connected: true,
    path: snapshotResult.path,
    ...getSystemStatus(snapshotResult.snapshot),
  }
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
