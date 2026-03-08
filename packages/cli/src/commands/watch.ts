/**
 * Watch command - Live dashboard (Pure ANSI, no React)
 */

import { listTraceInspectionEntries } from '@tracehound/core'
import Table from 'cli-table3'
import { Command } from 'commander'
import { createRequire } from 'module'
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
import { loadSystemSnapshot, type CliSnapshotLoadResult } from '../lib/system-snapshot.js'

const require = createRequire(import.meta.url)
const { version } = require('../../package.json')

export const watchCommand = new Command('watch')
  .description('Launch live dashboard')
  .option('-r, --refresh <ms>', 'Refresh interval in ms', '1000')
  .action((options) => {
    const refreshMs = parseInt(options.refresh, 10)
    startDashboard(refreshMs)
  })

interface Snapshot {
  timestamp: string
  system: {
    version: string
    uptime: string
    health: 'healthy' | 'degraded' | 'critical'
  }
  quarantine: {
    count: number
    bytes: number
    maxBytes: number
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

export function getSnapshot(): CliSnapshotLoadResult {
  return loadSystemSnapshot()
}

function toDashboardSnapshot(
  snapshotResult: Extract<CliSnapshotLoadResult, { ok: true }>,
): Snapshot {
  const snapshot = snapshotResult.snapshot
  const totalProcesses = snapshot.houndPool.totalProcesses
  const recentThreats = listTraceInspectionEntries(5).map((entry) => {
    const signature = entry.signature ?? ''
    const category = parseSignatureCategory(signature)

    return {
      signature: entry.signature,
      severity: entry.severity,
      category,
      size: formatBytes(entry.size),
      time: new Date(entry.captured).toLocaleTimeString(),
    }
  })

  return {
    timestamp: new Date(snapshot.generatedAt).toISOString(),
    system: {
      version,
      uptime: formatUptime(Math.floor(snapshot.watcher.uptimeMs / 1000)),
      health: snapshot.systemHealth,
    },
    quarantine: {
      count: snapshot.quarantine.count,
      bytes: snapshot.quarantine.bytes,
      maxBytes: snapshot.quarantineMaxBytes,
      bySeverity: snapshot.quarantine.bySeverity,
    },
    houndPool: {
      active: snapshot.houndPool.activeProcesses,
      dormant: Math.max(0, totalProcesses - snapshot.houndPool.activeProcesses),
      total: totalProcesses,
      status:
        totalProcesses > 0 && snapshot.houndPool.activeProcesses >= totalProcesses
          ? 'exhausted'
          : 'ok',
    },
    recentThreats,
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
    const snapshotResult = getSnapshot()

    if (snapshotResult.ok) {
      renderDashboard(toDashboardSnapshot(snapshotResult), refreshMs)
      return
    }

    renderDisconnected(snapshotResult, refreshMs)
  }

  render()
  setInterval(render, refreshMs)
}

export function renderDashboard(s: Snapshot, refreshMs: number): void {
  const width = 76

  // Header
  console.log()
  console.log(primary(`  ╔${'═'.repeat(width)}╗`))
  console.log(
    primary(`  ║${' '.repeat(20)}`) +
      bold('🐕 TRACEHOUND LIVE DASHBOARD') +
      primary(`${' '.repeat(28)}║`),
  )
  console.log(primary(`  ║${' '.repeat(24)}`) + muted(s.timestamp) + primary(`${' '.repeat(28)}║`))
  console.log(primary(`  ╚${'═'.repeat(width)}╝`))
  console.log()

  // System Status
  const systemTable = new Table({
    chars: getTableChars(),
    style: { head: [], border: [] },
    head: [secondary('Version'), secondary('Uptime'), secondary('Health')],
  })

  const healthIcon =
    s.system.health === 'healthy' ? '✅' : s.system.health === 'degraded' ? '⚠️' : '🔴'

  systemTable.push([s.system.version, s.system.uptime, `${healthIcon} ${s.system.health}`])

  console.log(muted('  SYSTEM'))
  console.log(indent(systemTable.toString()))
  console.log()

  // Quarantine & Hound Pool side by side
  const quarantineTable = new Table({
    chars: getTableChars(),
    style: { head: [], border: [] },
    head: [secondary('QUARANTINE'), secondary('Value')],
  })

  const qUsage = s.quarantine.maxBytes > 0 ? (s.quarantine.bytes / s.quarantine.maxBytes) * 100 : 0
  const qBar = progressBar(s.quarantine.bytes, s.quarantine.maxBytes || 1, 8)

  quarantineTable.push(
    ['Count', String(s.quarantine.count)],
    ['Usage', `${qBar} ${qUsage.toFixed(1)}%`],
    ['Bytes', `${formatBytes(s.quarantine.bytes)} / ${formatBytes(s.quarantine.maxBytes)}`],
    [
      'Split',
      `${severity('critical').slice(0, 15)} ${s.quarantine.bySeverity.critical}  ${severity(
        'high',
      ).slice(0, 12)} ${s.quarantine.bySeverity.high}  ${severity('medium').slice(0, 12)} ${
        s.quarantine.bySeverity.medium
      }  ${severity('low').slice(0, 10)} ${s.quarantine.bySeverity.low}`,
    ],
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
    ['Status', poolStatus],
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
        `${t.signature.slice(0, 12)}...`,
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
        new Date().toLocaleTimeString(),
      )}`,
    ),
  )
}

function renderDisconnected(
  snapshotResult: Extract<CliSnapshotLoadResult, { ok: false }>,
  refreshMs: number,
): void {
  const width = 76

  console.log()
  console.log(primary(`  ╔${'═'.repeat(width)}╗`))
  console.log(
    primary(`  ║${' '.repeat(20)}`) +
      bold('🐕 TRACEHOUND LIVE DASHBOARD') +
      primary(`${' '.repeat(28)}║`),
  )
  console.log(
    primary(`  ║${' '.repeat(14)}`) +
      muted('Runtime snapshot unavailable') +
      primary(`${' '.repeat(35)}║`),
  )
  console.log(primary(`  ╚${'═'.repeat(width)}╝`))
  console.log()
  console.log(muted(`  ❌ ${snapshotResult.code}`))
  console.log(muted(`  Snapshot path: ${snapshotResult.path}`))
  console.log()
  console.log(muted(`  ${'─'.repeat(width)}`))
  console.log(
    muted(
      `  Press Ctrl+C to exit │ Refresh: ${refreshMs}ms │ ${theme.reset}${secondary(
        new Date().toLocaleTimeString(),
      )}`,
    ),
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

function parseSignatureCategory(signature: string): string {
  const colonIndex = signature.indexOf(':')
  return colonIndex > 0 ? signature.slice(0, colonIndex) : 'unknown'
}
