/**
 * Inspect command - Inspect quarantine contents
 */

import Table from 'cli-table3'
import { Command } from 'commander'

const DEFAULT_LIMIT = 10

type LookupMode = 'signature' | 'traceId'

interface QuarantineEntry {
  traceId: string
  signature: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  category: string
  size: number
  captured: number
  source: string
}

const LOCAL_QUARANTINE_ENTRIES: readonly QuarantineEntry[] = [
  {
    traceId: 'trace-demo-opaque-0001',
    signature: 'sig_8f2d3b11c0a4',
    severity: 'high',
    category: 'injection',
    size: 1536,
    captured: 1_772_520_000_000,
    source: '127.0.0.1',
  },
  {
    traceId: 'trace-demo-opaque-0002',
    signature: 'sig_2d61c7af9b44',
    severity: 'medium',
    category: 'ddos',
    size: 4096,
    captured: 1_772_520_060_000,
    source: '10.0.0.45',
  },
]

export const inspectCommand = new Command('inspect')
  .description('Inspect quarantine contents')
  .argument('[traceId]', 'Inspect specific trace ID from x-tracehound-trace-id')
  .option('-s, --signature <sig>', 'Inspect specific signature')
  .option('-t, --trace-id <id>', 'Inspect specific trace ID')
  .option('-l, --limit <n>', 'Limit results', String(DEFAULT_LIMIT))
  .option('-j, --json', 'Output as JSON')
  .action((traceIdArg: string | undefined, options) => {
    const traceId = options.traceId ?? traceIdArg
    const json = Boolean(options.json)

    if (traceId) {
      inspectSingle(traceId, 'traceId', json)
      return
    }

    if (options.signature) {
      inspectSingle(options.signature, 'signature', json)
      return
    }

    inspectList(Number.parseInt(options.limit, 10), json)
  })

function getQuarantineEntries(limit: number): QuarantineEntry[] {
  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_LIMIT
  return LOCAL_QUARANTINE_ENTRIES.slice(0, normalizedLimit).map((entry) => ({ ...entry }))
}

function getEntry(identifier: string, mode: LookupMode): QuarantineEntry | null {
  const entry =
    mode === 'traceId'
      ? LOCAL_QUARANTINE_ENTRIES.find((item) => item.traceId === identifier)
      : LOCAL_QUARANTINE_ENTRIES.find((item) => item.signature === identifier)

  return entry ? { ...entry } : null
}

function inspectSingle(identifier: string, mode: LookupMode, json: boolean): void {
  const entry = getEntry(identifier, mode)

  if (!entry) {
    const label = mode === 'traceId' ? 'trace id' : 'signature'
    console.log(`\n  ❌ Evidence not found for ${label}: ${identifier}\n`)
    return
  }

  if (json) {
    console.log(JSON.stringify(entry, null, 2))
  } else {
    printEntry(entry)
  }
}

function inspectList(limit: number, json: boolean): void {
  const entries = getQuarantineEntries(limit)

  if (json) {
    console.log(JSON.stringify(entries, null, 2))
    return
  }

  if (entries.length === 0) {
    console.log('\n  📭 Quarantine is empty\n')
    return
  }

  console.log('\n  ╔══════════════════════════════════════════════════════════════╗')
  console.log('  ║                    QUARANTINE CONTENTS                       ║')
  console.log('  ╚══════════════════════════════════════════════════════════════╝\n')

  const table = new Table({
    head: ['Trace ID', 'Severity', 'Category', 'Size', 'Source'],
    style: { head: ['cyan'], border: ['gray'] },
    colWidths: [20, 12, 12, 10, 16],
  })

  for (const entry of entries) {
    const severityIcon = getSeverityIcon(entry.severity)
    table.push([
      shorten(entry.traceId, 16),
      `${severityIcon} ${entry.severity}`,
      entry.category,
      formatBytes(entry.size),
      shorten(entry.source, 13),
    ])
  }

  console.log(table.toString())
  console.log()
}

function printEntry(entry: QuarantineEntry): void {
  const severityIcon = getSeverityIcon(entry.severity)

  console.log('\n  ╔══════════════════════════════════════════════════════════════╗')
  console.log('  ║                     EVIDENCE DETAILS                         ║')
  console.log('  ╚══════════════════════════════════════════════════════════════╝\n')

  const table = new Table({
    style: { border: ['gray'] },
  })

  table.push(
    { 'Trace ID': entry.traceId },
    { Signature: entry.signature },
    { Severity: `${severityIcon} ${entry.severity}` },
    { Category: entry.category },
    { Size: formatBytes(entry.size) },
    { Source: entry.source },
    { Captured: new Date(entry.captured).toISOString() },
  )

  console.log(table.toString())
  console.log()
}

function shorten(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }
  return `${value.slice(0, maxLength - 3)}...`
}

function getSeverityIcon(severity: string): string {
  switch (severity) {
    case 'critical':
      return '🔴'
    case 'high':
      return '🟠'
    case 'medium':
      return '🟡'
    case 'low':
      return '🟢'
    default:
      return '⚪'
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

