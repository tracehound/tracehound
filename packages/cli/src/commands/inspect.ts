/**
 * Inspect command - Inspect quarantine contents
 */

import {
  findTraceInspectionEntryBySignature,
  getTraceInspectionEntry,
  listTraceInspectionEntries,
  type TraceInspectionEntry,
} from '@tracehound/core'
import Table from 'cli-table3'
import { Command } from 'commander'

const DEFAULT_LIMIT = 10

type LookupMode = 'signature' | 'traceId'

type QuarantineEntry = TraceInspectionEntry

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
  return listTraceInspectionEntries(normalizedLimit)
}

function getEntry(identifier: string, mode: LookupMode): QuarantineEntry | null {
  return mode === 'traceId'
    ? getTraceInspectionEntry(identifier)
    : findTraceInspectionEntryBySignature(identifier)
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
      inferCategory(entry.signature),
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
    { Category: inferCategory(entry.signature) },
    { Size: formatBytes(entry.size) },
    { Source: entry.source },
    { Captured: new Date(entry.captured).toISOString() },
    { Recorded: new Date(entry.recordedAt).toISOString() },
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

function inferCategory(signature: string): string {
  if (signature.startsWith('injection:')) {
    return 'injection'
  }
  if (signature.startsWith('ddos:')) {
    return 'ddos'
  }
  return 'unknown'
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
