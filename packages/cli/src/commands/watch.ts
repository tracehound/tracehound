/**
 * Watch command - Live multi-screen dashboard (Pure ANSI, no React)
 *
 * Screens:  overview | watcher | quarantine | pool | agent | help
 * Nav keys: [1] overview  [2] watcher  [3] quarantine  [4] pool  [5] agent
 *           [h] help  [r] refresh  [q] quit
 *
 * Width modes (auto-detected from terminal columns):
 *   compact   < 100 cols  – fewer columns, top-3 categories
 *   normal    100–140     – full columns, top-5 categories
 *   extended  > 140       – same as normal, wider sections
 */

import { listTraceInspectionEntries } from '@tracehound/core'
import { Command } from 'commander'
import { createRequire } from 'module'
import { fmtBytes, fmtCount, fmtDuration, fmtStatus, fmtUptime } from '../lib/format.js'
import { loadSystemSnapshot, type CliSnapshotLoadResult } from '../lib/system-snapshot.js'
import {
  bold,
  clearScreen,
  hideCursor,
  muted,
  primary,
  secondary,
  severity as severityColor,
  showCursor,
  warning,
} from '../lib/theme.js'

const require = createRequire(import.meta.url)
const { version } = require('../../package.json')

// ── Types ──────────────────────────────────────────────────────────────────

export type Screen = 'overview' | 'watcher' | 'quarantine' | 'pool' | 'agent' | 'help'
type WidthMode = 'compact' | 'normal' | 'extended'

interface Snapshot {
  timestamp: string
  agent: {
    total: number
    clean: number
    quarantined: number
    rateLimited: number
    ignored: number
    validationFailures: number
    membraneRejections: number
    errors: number
  }
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
    archiveFailures: number
    dropped: number
    nextExpiryAt: number | null
  }
  houndPool: {
    active: number
    dormant: number
    total: number
    totalActivations: number
    avgProcessingMs: number
    totalTimeouts: number
    totalErrors: number
    status: 'ok' | 'exhausted'
  }
  rateLimiter: {
    sources: number
    blocked: number
    totalRejections: number
    totalEvictions: number
  }
  watcher: {
    threatTotal: number
    byCategory: Record<string, number>
    lastAlert: { type: string; time: string } | null
  }
  recentThreats: Array<{
    signature: string
    severity: string
    category: string
    size: string
    time: string
  }>
}

// ── Width helpers ──────────────────────────────────────────────────────────

function resolveWidth(): number {
  return process.stdout.columns ?? 80
}

function calcWidthMode(w: number): WidthMode {
  if (w < 100) return 'compact'
  if (w <= 140) return 'normal'
  return 'extended'
}

// ── Layout primitives ──────────────────────────────────────────────────────

/** Section divider: ┌ TITLE ──────────────────────── */
function sec(title: string, w: number): string {
  const dashes = Math.max(0, w - title.length - 3)
  return `${secondary(`┌ ${title} `)}${muted('─'.repeat(dashes))}`
}

/** Single labelled field: "  label:          value" */
function field(label: string, value: string, lw = 18): string {
  return `  ${muted((label + ':').padEnd(lw))}${bold(value)}`
}

/** Two-column row with fixed first-column width */
function row2(c1: string, c2: string, w1 = 26): string {
  return `  ${c1.padEnd(w1)}${c2}`
}

/** Three-column row with fixed first and second column widths */
function row3(c1: string, c2: string, c3: string, w1 = 26, w2 = 26): string {
  return `  ${c1.padEnd(w1)}${c2.padEnd(w2)}${c3}`
}

/** Five-column subsystem row: label + 4 data fields */
function subsysRow(label: string, f1: string, f2: string, f3: string, f4: string): string {
  return `  ${bold(label.padEnd(16))}${f1.padEnd(17)}${f2.padEnd(17)}${f3.padEnd(17)}${f4}`
}

/** Three-column subsystem row for compact mode */
function subsysRowCompact(label: string, f1: string, f2: string): string {
  return `  ${bold(label.padEnd(16))}${f1.padEnd(22)}${f2}`
}

// ── Category label map ─────────────────────────────────────────────────────

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  injection: 'SQL/command injection',
  sqli: 'SQL injection',
  xss: 'Cross-site scripting',
  path: 'Path traversal',
  proto: 'Protocol anomaly',
  anomaly: 'Behavioral anomaly',
  ddos: 'DDoS',
  flood: 'Flood',
  spam: 'Spam',
  malware: 'Malware',
  unknown: 'Unknown',
}

// ── Snapshot mapping ───────────────────────────────────────────────────────

export function getSnapshot(): CliSnapshotLoadResult {
  return loadSystemSnapshot()
}

function toDashboardSnapshot(
  snapshotResult: Extract<CliSnapshotLoadResult, { ok: true }>,
): Snapshot {
  const snapshot = snapshotResult.snapshot
  const totalProcesses = snapshot.houndPool.totalProcesses

  const recentThreats = listTraceInspectionEntries(5).map((entry) => {
    const sig = entry.signature ?? ''
    const colonIndex = sig.indexOf(':')
    const category = colonIndex > 0 ? sig.slice(0, colonIndex) : 'unknown'
    return {
      signature: entry.signature,
      severity: entry.severity,
      category,
      size: fmtBytes(entry.size),
      time: new Date(entry.captured).toLocaleTimeString(),
    }
  })

  return {
    timestamp: new Date(snapshot.generatedAt).toISOString(),
    agent: {
      total: snapshot.agent.totalIntercepts,
      clean: snapshot.agent.cleanCount,
      quarantined: snapshot.agent.quarantinedCount,
      rateLimited: snapshot.agent.rateLimitedCount,
      ignored: snapshot.agent.ignoredCount,
      validationFailures: snapshot.agent.validationFailures,
      membraneRejections: snapshot.agent.membraneRejectionCount,
      errors: snapshot.agent.errorCount,
    },
    system: {
      version,
      uptime: fmtUptime(Math.floor(snapshot.watcher.uptimeMs / 1000)),
      health: snapshot.systemHealth,
    },
    quarantine: {
      count: snapshot.quarantine.count,
      bytes: snapshot.quarantine.bytes,
      maxBytes: snapshot.quarantineMaxBytes,
      bySeverity: snapshot.quarantine.bySeverity,
      archiveFailures: snapshot.quarantine.archiveFailureCount ?? 0,
      dropped: snapshot.quarantine.droppedCount,
      nextExpiryAt: snapshot.quarantine.nextExpiryAt ?? null,
    },
    houndPool: {
      active: snapshot.houndPool.activeProcesses,
      dormant: Math.max(0, totalProcesses - snapshot.houndPool.activeProcesses),
      total: totalProcesses,
      totalActivations: snapshot.houndPool.totalActivations,
      avgProcessingMs: snapshot.houndPool.avgProcessingMs,
      totalTimeouts: snapshot.houndPool.totalTimeouts,
      totalErrors: snapshot.houndPool.totalErrors,
      status:
        totalProcesses > 0 && snapshot.houndPool.activeProcesses >= totalProcesses
          ? 'exhausted'
          : 'ok',
    },
    rateLimiter: {
      sources: snapshot.rateLimiter.sources,
      blocked: snapshot.rateLimiter.blocked,
      totalRejections: snapshot.rateLimiter.totalRejections,
      totalEvictions: snapshot.rateLimiter.totalEvictions,
    },
    watcher: {
      threatTotal: snapshot.watcher.threats.total,
      byCategory: snapshot.watcher.threats.byCategory,
      lastAlert: snapshot.watcher.lastAlert
        ? {
            type: snapshot.watcher.lastAlert.type,
            time: new Date(snapshot.watcher.lastAlert.timestamp).toLocaleTimeString(),
          }
        : null,
    },
    recentThreats,
  }
}

// ── Screen: OVERVIEW ──────────────────────────────────────────────────────

export function renderOverview(s: Snapshot, w: number, refreshMs: number): void {
  const mode = calcWidthMode(w)
  const now = new Date()

  const poolStatus = s.houndPool.status === 'exhausted' ? 'EXHAUSTED' : 'STABLE'
  const qStatus =
    s.quarantine.archiveFailures > 0 || s.quarantine.dropped > 0 ? 'DEGRADED' : 'NOMINAL'
  const agentStatus = s.system.health === 'healthy' ? 'OK' : fmtStatus(s.system.health)
  const rlStatus = s.rateLimiter.blocked > 0 ? 'ENFORCING' : 'IDLE'

  // Header
  console.log()
  const htitle = '  Tracehound Watcher '
  console.log(primary(htitle + '─'.repeat(Math.max(0, w - htitle.length))))
  console.log(
    muted(
      `  v${s.system.version}   uptime: ${s.system.uptime}   health: ${fmtStatus(s.system.health)}   refresh: ${refreshMs}ms   time: ${now.toLocaleTimeString()}`,
    ),
  )
  console.log()

  // SYSTEM
  console.log(sec('SYSTEM', w))
  console.log(
    row3(`Agent ${agentStatus}`, `Hound Pool ${poolStatus}`, `Quarantine ${qStatus}`, 28, 30),
  )
  console.log(row2(`Watcher ACTIVE`, `Rate Limiter ${rlStatus}`, 28))
  console.log()

  // LOAD
  console.log(sec('LOAD', w))
  console.log(
    row3(
      `Events ${fmtCount(s.agent.total)}`,
      `Threats ${fmtCount(s.watcher.threatTotal)}`,
      `Blocked ${fmtCount(s.rateLimiter.blocked)}`,
      26,
      26,
    ),
  )
  console.log(
    row3(
      `Quarantined ${fmtCount(s.agent.quarantined)}`,
      `Errors ${s.agent.errors}`,
      `Avg Proc ${s.houndPool.avgProcessingMs.toFixed(0)}ms`,
      26,
      26,
    ),
  )
  console.log()

  // WATCHER
  const topN = mode === 'compact' ? 3 : 5
  const lastThreat = s.recentThreats[0]
  const topCats = Object.entries(s.watcher.byCategory)
    .sort(([, a], [, b]) => b - a)
    .slice(0, topN)
    .map(([cat, count]) => `${cat}:${count}`)
    .join('  ')

  console.log(sec('WATCHER', w))
  console.log(
    field(
      'Last Alert',
      s.watcher.lastAlert ? `${s.watcher.lastAlert.type} @ ${s.watcher.lastAlert.time}` : '–',
    ),
  )
  console.log(
    field(
      'Last Threat',
      lastThreat ? `${lastThreat.category}  ${lastThreat.signature.slice(0, 18)}...` : '–',
    ),
  )
  console.log(field('Top Categories', topCats || '–'))
  console.log()

  // SUBSYSTEMS
  const nextExpStr = s.quarantine.nextExpiryAt
    ? fmtDuration(Math.max(0, s.quarantine.nextExpiryAt - Date.now()))
    : '–'

  console.log(sec('SUBSYSTEMS', w))
  if (mode === 'compact') {
    console.log(
      subsysRowCompact('Agent', `Total ${fmtCount(s.agent.total)}`, `Errors ${s.agent.errors}`),
    )
    console.log(
      subsysRowCompact(
        'Hound Pool',
        `Active ${s.houndPool.active}/${s.houndPool.total}`,
        `Timeouts ${s.houndPool.totalTimeouts}`,
      ),
    )
    console.log(
      subsysRowCompact(
        'Rate Limiter',
        `Blocked ${s.rateLimiter.blocked}`,
        `Evictions ${s.rateLimiter.totalEvictions}`,
      ),
    )
    console.log(
      subsysRowCompact(
        'Quarantine',
        `Count ${s.quarantine.count}`,
        `Dropped ${s.quarantine.dropped}`,
      ),
    )
  } else {
    console.log(
      subsysRow(
        'Agent',
        `Total ${fmtCount(s.agent.total)}`,
        `Clean ${fmtCount(s.agent.clean)}`,
        `Quarantined ${fmtCount(s.agent.quarantined)}`,
        `Errors ${s.agent.errors}`,
      ),
    )
    console.log(
      subsysRow(
        'Hound Pool',
        `Active ${s.houndPool.active}/${s.houndPool.total}`,
        `Dormant ${s.houndPool.dormant}`,
        `Avg ${s.houndPool.avgProcessingMs.toFixed(0)}ms`,
        `Timeouts ${s.houndPool.totalTimeouts}`,
      ),
    )
    console.log(
      subsysRow(
        'Rate Limiter',
        `Sources ${s.rateLimiter.sources}`,
        `Blocked ${s.rateLimiter.blocked}`,
        `Rejected ${s.rateLimiter.totalRejections}`,
        `Evictions ${s.rateLimiter.totalEvictions}`,
      ),
    )
    console.log(
      subsysRow(
        'Quarantine',
        `Count ${s.quarantine.count}`,
        `Usage ${fmtBytes(s.quarantine.bytes)}`,
        `Dropped ${s.quarantine.dropped}`,
        `Next Exp ${nextExpStr}`,
      ),
    )
  }
  console.log()

  // WARNING (only when system is not fully healthy)
  const hasWarning =
    s.system.health !== 'healthy' || s.agent.errors > 0 || s.quarantine.archiveFailures > 0

  if (hasWarning) {
    console.log(sec('WARNING', w))
    if (s.system.health !== 'healthy') {
      console.log(warning(`  [${fmtStatus(s.system.health)}] System Health ${s.system.health}`))
    }
    if (s.agent.errors > 0) {
      console.log(warning(`  [HIGH] ${s.agent.errors} Agent Error(s) Detected`))
    }
    if (s.quarantine.archiveFailures > 0) {
      console.log(warning(`  [MEDIUM] ${s.quarantine.archiveFailures} Archive Failure(s)`))
    }
    console.log()
  }

  // COMMANDS
  console.log(sec('COMMANDS', w))
  console.log(
    muted('  [1] Overview  [2] Watcher  [3] Quarantine  [4] Pool  [5] Agent  [h] Help  [q] Quit'),
  )
}

// ── Screen: WATCHER ───────────────────────────────────────────────────────

export function renderWatcher(s: Snapshot, w: number): void {
  const mode = calcWidthMode(w)
  const alertRows = mode === 'compact' ? 2 : 4

  // Header
  console.log()
  const htitle = '  Watcher ─ Threat Overview '
  console.log(primary(htitle + '─'.repeat(Math.max(0, w - htitle.length))))
  console.log(
    muted(
      `  threat total ${fmtCount(s.watcher.threatTotal)}   last alert ${s.watcher.lastAlert ? s.watcher.lastAlert.time : '–'}   refresh auto`,
    ),
  )
  console.log()

  // CATEGORY SUMMARY
  console.log(sec('CATEGORY SUMMARY', w))
  const entries = Object.entries(s.watcher.byCategory).sort(([, a], [, b]) => b - a)
  if (entries.length > 0) {
    for (const [cat, count] of entries) {
      console.log(field(cat, String(count)))
    }
  } else {
    console.log(muted('  no threat categories recorded'))
  }
  console.log()

  // RECENT ALERTS
  console.log(sec('RECENT ALERTS', w))
  if (s.recentThreats.length > 0) {
    for (const t of s.recentThreats.slice(0, alertRows)) {
      const sigTrunc = t.signature.slice(0, 20)
      console.log(
        `  ${muted('[' + t.time + ']')} ${severityColor(t.severity)}  ${bold(t.category.padEnd(14))} ${muted(sigTrunc + '...')}`,
      )
    }
  } else {
    console.log(muted('  no recent alerts'))
  }
  console.log()

  // LAST ALERT DETAIL
  if (s.recentThreats.length > 0) {
    const t = s.recentThreats[0]
    console.log(sec('LAST ALERT DETAIL', w))
    console.log(field('id', `${t.signature.slice(0, 16)}...`))
    console.log(field('category', t.category))
    console.log(field('severity', severityColor(t.severity)))
    console.log(field('size', t.size))
    console.log(field('time', t.time))
    console.log()
  }

  // COMMANDS
  console.log(sec('COMMANDS', w))
  console.log(muted('  [1] Overview  [3] Quarantine  [4] Pool  [5] Agent  [r] Refresh  [q] Quit'))
}

// ── Screen: QUARANTINE ────────────────────────────────────────────────────

export function renderQuarantine(s: Snapshot, w: number): void {
  const usagePct =
    s.quarantine.maxBytes > 0
      ? ((s.quarantine.bytes / s.quarantine.maxBytes) * 100).toFixed(1)
      : '0.0'
  const archiveStatus = s.quarantine.archiveFailures > 0 ? 'DEGRADED' : 'OK'
  const nextExpStr = s.quarantine.nextExpiryAt
    ? fmtDuration(Math.max(0, s.quarantine.nextExpiryAt - Date.now()))
    : '–'
  const bySev = s.quarantine.bySeverity

  // Header
  console.log()
  const htitle = '  Quarantine ─ Storage & Retention '
  console.log(primary(htitle + '─'.repeat(Math.max(0, w - htitle.length))))
  console.log(
    muted(
      `  count ${s.quarantine.count}   usage ${fmtBytes(s.quarantine.bytes)}   dropped ${s.quarantine.dropped}   archive fail ${s.quarantine.archiveFailures}   next expiration ${nextExpStr}`,
    ),
  )
  console.log()

  // STORAGE
  console.log(sec('STORAGE', w))
  console.log(field('total bytes', fmtCount(s.quarantine.bytes)))
  console.log(
    field(
      'usage',
      `${fmtBytes(s.quarantine.bytes)} / ${fmtBytes(s.quarantine.maxBytes)} (${usagePct}%)`,
    ),
  )
  console.log(field('archive status', archiveStatus))
  console.log(field('dropped items', String(s.quarantine.dropped)))
  console.log()

  // SPLIT BY SEVERITY
  console.log(sec('SPLIT BY SEVERITY', w))
  console.log(field('critical', String(bySev.critical)))
  console.log(field('high', String(bySev.high)))
  console.log(field('medium', String(bySev.medium)))
  console.log(field('low', String(bySev.low)))
  console.log()

  // RETENTION
  console.log(sec('RETENTION', w))
  console.log(field('next expiration', nextExpStr))
  console.log(field('archive failures', String(s.quarantine.archiveFailures)))
  console.log()

  // COMMANDS
  console.log(sec('COMMANDS', w))
  console.log(muted('  [1] Overview  [2] Watcher  [4] Pool  [5] Agent  [q] Quit'))
}

// ── Screen: POOL ──────────────────────────────────────────────────────────

export function renderPool(s: Snapshot, w: number): void {
  const poolStatus = s.houndPool.status === 'exhausted' ? 'EXHAUSTED' : 'STABLE'

  // Header
  console.log()
  const htitle = '  Hound Pool ─ Execution State '
  console.log(primary(htitle + '─'.repeat(Math.max(0, w - htitle.length))))
  console.log(
    muted(
      `  status ${poolStatus}   active ${s.houndPool.active}/${s.houndPool.total}   dormant ${s.houndPool.dormant}   avg time ${s.houndPool.avgProcessingMs.toFixed(0)}ms   timeouts ${s.houndPool.totalTimeouts}   errors ${s.houndPool.totalErrors}`,
    ),
  )
  console.log()

  // POOL STATE
  console.log(sec('POOL STATE', w))
  console.log(field('capacity', String(s.houndPool.total)))
  console.log(field('active', `${s.houndPool.active}/${s.houndPool.total}`))
  console.log(field('dormant', String(s.houndPool.dormant)))
  console.log(field('activations', fmtCount(s.houndPool.totalActivations)))
  console.log(field('status', poolStatus))
  console.log()

  // TIMING
  console.log(sec('TIMING', w))
  console.log(field('avg time', `${s.houndPool.avgProcessingMs.toFixed(1)}ms`))
  console.log(field('timeouts', String(s.houndPool.totalTimeouts)))
  console.log(field('errors', String(s.houndPool.totalErrors)))
  console.log()

  // COMMANDS
  console.log(sec('COMMANDS', w))
  console.log(muted('  [1] Overview  [2] Watcher  [3] Quarantine  [5] Agent  [q] Quit'))
}

// ── Screen: AGENT ─────────────────────────────────────────────────────────

export function renderAgent(s: Snapshot, w: number): void {
  // Header
  console.log()
  const htitle = '  Agent ─ Intake & Validation '
  console.log(primary(htitle + '─'.repeat(Math.max(0, w - htitle.length))))
  console.log(
    muted(
      `  total ${s.agent.total}   clean ${s.agent.clean}   quarantined ${s.agent.quarantined}   errors ${s.agent.errors}   ignored ${s.agent.ignored}`,
    ),
  )
  console.log()

  // FLOW
  console.log(sec('FLOW', w))
  console.log(field('total processed', fmtCount(s.agent.total)))
  console.log(field('clean', fmtCount(s.agent.clean)))
  console.log(field('quarantined', fmtCount(s.agent.quarantined)))
  console.log(field('ignored', fmtCount(s.agent.ignored)))
  console.log(field('errors', String(s.agent.errors)))
  console.log()

  // REJECTIONS
  console.log(sec('REJECTIONS', w))
  console.log(field('malformed', String(s.agent.membraneRejections)))
  console.log(field('validation fail', String(s.agent.validationFailures)))
  console.log(field('rate limited', String(s.agent.rateLimited)))
  console.log()

  if (s.agent.errors > 0) {
    console.log(sec('LAST ERROR', w))
    console.log(muted(`  ${s.agent.errors} error(s) detected in agent processing`))
    console.log()
  }

  // COMMANDS
  console.log(sec('COMMANDS', w))
  console.log(muted('  [1] Overview  [2] Watcher  [3] Quarantine  [4] Pool  [q] Quit'))
}

// ── Screen: HELP ──────────────────────────────────────────────────────────

export function renderHelp(w: number): void {
  // Header
  console.log()
  const htitle = '  Help ─ Keys & Labels '
  console.log(primary(htitle + '─'.repeat(Math.max(0, w - htitle.length))))
  console.log()

  // NAVIGATION
  console.log(sec('NAVIGATION', w))
  console.log(field('1', 'Overview'))
  console.log(field('2', 'Watcher'))
  console.log(field('3', 'Quarantine'))
  console.log(field('4', 'Pool'))
  console.log(field('5', 'Agent'))
  console.log(field('h', 'Help'))
  console.log(field('q', 'Quit'))
  console.log(field('r', 'Manual Refresh'))
  console.log()

  // LABELS
  console.log(sec('LABELS', w))
  for (const [k, v] of Object.entries(CATEGORY_LABELS)) {
    console.log(field(k, v))
  }
  console.log()

  // STATUS
  console.log(sec('STATUS', w))
  console.log(field('HEALTHY', 'System Nominal'))
  console.log(field('DEGRADED', 'Partial Failure or Pressure'))
  console.log(field('CRITICAL', 'Operator Attention Required'))
  console.log(field('STABLE', 'Hound Pool Operating Normally'))
  console.log(field('EXHAUSTED', 'All Hound Slots in Use'))
  console.log(field('NOMINAL', 'Quarantine Buffer Healthy'))
  console.log(field('ENFORCING', 'Rate Limiter Blocking Sources'))
}

// ── Dispatcher ────────────────────────────────────────────────────────────

export function renderScreen(screen: Screen, s: Snapshot, w: number, refreshMs: number): void {
  switch (screen) {
    case 'overview':
      renderOverview(s, w, refreshMs)
      break
    case 'watcher':
      renderWatcher(s, w)
      break
    case 'quarantine':
      renderQuarantine(s, w)
      break
    case 'pool':
      renderPool(s, w)
      break
    case 'agent':
      renderAgent(s, w)
      break
    case 'help':
      renderHelp(w)
      break
  }
}

// ── Disconnected state ────────────────────────────────────────────────────

function renderDisconnected(
  snapshotResult: Extract<CliSnapshotLoadResult, { ok: false }>,
  refreshMs: number,
): void {
  const w = resolveWidth()
  console.log()
  const htitle = '  Tracehound Watcher '
  console.log(primary(htitle + '─'.repeat(Math.max(0, w - htitle.length))))
  console.log(muted('  Runtime snapshot unavailable'))
  console.log()
  console.log(muted(`  ${snapshotResult.code}`))
  console.log(muted(`  Snapshot path: ${snapshotResult.path}`))
  console.log()
  console.log(
    muted(`  Press Ctrl+C to exit │ Refresh: ${refreshMs}ms │ ${new Date().toLocaleTimeString()}`),
  )
}

// ── Dashboard entry point ─────────────────────────────────────────────────

function startDashboard(refreshMs: number): void {
  hideCursor()

  const ui: { screen: Screen } = { screen: 'overview' }

  const cleanup = (): void => {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false)
    }
    showCursor()
    clearScreen()
    console.log(muted('\n  Dashboard closed.\n'))
    process.exit(0)
  }

  process.on('SIGINT', cleanup)

  const render = (): void => {
    clearScreen()
    const snapshotResult = getSnapshot()
    if (snapshotResult.ok) {
      const w = resolveWidth()
      renderScreen(ui.screen, toDashboardSnapshot(snapshotResult), w, Math.ceil(refreshMs / 1000))
    } else {
      renderDisconnected(snapshotResult, refreshMs)
    }
  }

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (key: string) => {
      switch (key) {
        case '1':
          ui.screen = 'overview'
          render()
          break
        case '2':
          ui.screen = 'watcher'
          render()
          break
        case '3':
          ui.screen = 'quarantine'
          render()
          break
        case '4':
          ui.screen = 'pool'
          render()
          break
        case '5':
          ui.screen = 'agent'
          render()
          break
        case 'h':
          ui.screen = 'help'
          render()
          break
        case 'r':
          render()
          break
        case 'q':
        case '\u0003':
          cleanup()
          break
      }
    })
  }

  render()
  setInterval(render, refreshMs)
}

// ── Public compat export ──────────────────────────────────────────────────

/**
 * Render the overview screen.
 * Exported for direct use in tests and external callers.
 */
export function renderDashboard(s: Snapshot, refreshMs: number): void {
  renderOverview(s, resolveWidth(), Math.ceil(refreshMs / 1000))
}

// ── Command definition ────────────────────────────────────────────────────

export const watchCommand = new Command('watch')
  .description('Launch live dashboard')
  .option('-r, --refresh <ms>', 'Refresh interval in ms', '1000')
  .action((options) => {
    const parsed = parseInt(options.refresh, 10)
    const refreshMs = Number.isFinite(parsed) && !Number.isNaN(parsed) && parsed > 0 ? parsed : 1000
    startDashboard(refreshMs)
  })
