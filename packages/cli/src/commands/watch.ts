/**
 * Watch command - Live dashboard (Pure ANSI, no React)
 */

import Table from 'cli-table3'
import { Command } from 'commander'
import {
  bold,
  clearScreen,
  hideCursor,
  muted,
  primary,
  progressBar,
  secondary,
  severity,
  showCursor,
  theme,
} from '../lib/theme.js'

export const watchCommand = new Command('watch')
  .description('Launch live dashboard')
  .option('-r, --refresh <ms>', 'Refresh interval in ms', '1000')
  .action((options) => {
    const refreshMs = parseInt(options.refresh)
    startDashboard(refreshMs)
  })

interface Snapshot {
  timestamp: string
  system: {
    version: string
    uptime: string
    health: 'healthy' | 'degraded' | 'critical'
    memory: { used: number; total: number }
  }
  quarantine: {
    count: number
    capacity: number
    bytes: number
    bySeverity: { critical: number; high: number; medium: number; low: number }
  }
  houndPool: {
    active: number
    dormant: number
    total: number
    status: 'ok' | 'exhausted'
  }
  recentThreats: Array<{
    signature: string
    severity: string
    category: string
    size: string
    time: string
  }>
}

function getSnapshot(): Snapshot {
  // TODO: Connect to real core
  return {
    timestamp: new Date().toISOString(),
    system: {
      version: '0.1.0',
      uptime: formatUptime(Math.floor(process.uptime())),
      health: 'healthy',
      memory: { used: 45, total: 256 },
    },
    quarantine: {
      count: 0,
      capacity: 1000,
      bytes: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
    },
    houndPool: {
      active: 0,
      dormant: 0,
      total: 0,
      status: 'ok',
    },
    recentThreats: [],
  }
}

function startDashboard(refreshMs: number): void {
  hideCursor()

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    showCursor()
    clearScreen()
    console.log(muted('\n  Dashboard closed.\n'))
    process.exit(0)
  })

  const render = () => {
    clearScreen()
    const snapshot = getSnapshot()
    renderDashboard(snapshot, refreshMs)
  }

  render()
  setInterval(render, refreshMs)
}

function renderDashboard(s: Snapshot, refreshMs: number): void {
  const width = 76

  // Header
  console.log()
  console.log(primary(`  ╔${'═'.repeat(width)}╗`))
  console.log(
    primary(`  ║${' '.repeat(20)}`) +
      bold('🐕 TRACEHOUND LIVE DASHBOARD') +
      primary(`${' '.repeat(28)}║`)
  )
  console.log(primary(`  ║${' '.repeat(24)}`) + muted(s.timestamp) + primary(`${' '.repeat(28)}║`))
  console.log(primary(`  ╚${'═'.repeat(width)}╝`))
  console.log()

  // System Status
  const systemTable = new Table({
    chars: getTableChars(),
    style: { head: [], border: [] },
    head: [secondary('Version'), secondary('Uptime'), secondary('Health'), secondary('Memory')],
  })

  const healthIcon =
    s.system.health === 'healthy' ? '✅' : s.system.health === 'degraded' ? '⚠️' : '🔴'
  const memBar = progressBar(s.system.memory.used, s.system.memory.total, 10)

  systemTable.push([
    s.system.version,
    s.system.uptime,
    `${healthIcon} ${s.system.health}`,
    `${memBar} ${s.system.memory.used}/${s.system.memory.total} MB`,
  ])

  console.log(muted('  SYSTEM'))
  console.log(indent(systemTable.toString()))
  console.log()

  // Quarantine & Hound Pool side by side
  const quarantineTable = new Table({
    chars: getTableChars(),
    style: { head: [], border: [] },
    head: [secondary('QUARANTINE'), secondary('Value')],
  })

  const qUsage = s.quarantine.capacity > 0 ? (s.quarantine.count / s.quarantine.capacity) * 100 : 0
  const qBar = progressBar(s.quarantine.count, s.quarantine.capacity, 8)

  quarantineTable.push(
    ['Count', `${s.quarantine.count} / ${s.quarantine.capacity}`],
    ['Usage', `${qBar} ${qUsage.toFixed(1)}%`],
    ['Bytes', formatBytes(s.quarantine.bytes)],
    [
      'Split',
      `${severity('critical').slice(0, 15)} ${s.quarantine.bySeverity.critical}  ${severity(
        'high'
      ).slice(0, 12)} ${s.quarantine.bySeverity.high}  ${severity('medium').slice(0, 12)} ${
        s.quarantine.bySeverity.medium
      }  ${severity('low').slice(0, 10)} ${s.quarantine.bySeverity.low}`,
    ]
  )

  const poolTable = new Table({
    chars: getTableChars(),
    style: { head: [], border: [] },
    head: [secondary('HOUND POOL'), secondary('Value')],
  })

  const poolBar = progressBar(s.houndPool.active, s.houndPool.total || 1, 8)
  const poolStatus = s.houndPool.status === 'ok' ? '✅ OK' : '🔴 EXHAUSTED'

  poolTable.push(
    ['Active', `${poolBar} ${s.houndPool.active}/${s.houndPool.total}`],
    ['Dormant', String(s.houndPool.dormant)],
    ['Status', poolStatus]
  )

  console.log(indent(quarantineTable.toString()))
  console.log()
  console.log(indent(poolTable.toString()))
  console.log()

  // Recent Threats
  if (s.recentThreats.length > 0) {
    const threatTable = new Table({
      chars: getTableChars(),
      style: { head: [], border: [] },
      head: [
        secondary('Signature'),
        secondary('Severity'),
        secondary('Category'),
        secondary('Size'),
        secondary('Time'),
      ],
    })

    for (const t of s.recentThreats.slice(0, 5)) {
      threatTable.push([
        t.signature.slice(0, 12) + '...',
        severity(t.severity),
        t.category,
        t.size,
        t.time,
      ])
    }

    console.log(muted('  RECENT THREATS'))
    console.log(indent(threatTable.toString()))
    console.log()
  } else {
    console.log(muted('  RECENT THREATS'))
    console.log(muted('  📭 No recent threats'))
    console.log()
  }

  // Footer
  console.log(muted(`  ${'─'.repeat(width)}`))
  console.log(
    muted(
      `  Press Ctrl+C to exit │ Refresh: ${refreshMs}ms │ ${theme.reset}${secondary(
        new Date().toLocaleTimeString()
      )}`
    )
  )
}

function getTableChars() {
  return {
    top: '─',
    'top-mid': '┬',
    'top-left': '┌',
    'top-right': '┐',
    bottom: '─',
    'bottom-mid': '┴',
    'bottom-left': '└',
    'bottom-right': '┘',
    left: '│',
    'left-mid': '├',
    mid: '─',
    'mid-mid': '┼',
    right: '│',
    'right-mid': '┤',
    middle: '│',
  }
}

function indent(text: string, spaces = 2): string {
  return text
    .split('\n')
    .map((line) => ' '.repeat(spaces) + line)
    .join('\n')
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
