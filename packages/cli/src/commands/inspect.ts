/**
 * Inspect command - Inspect quarantine contents
 */

import Table from 'cli-table3'
import { Command } from 'commander'

export const inspectCommand = new Command('inspect')
  .description('Inspect quarantine contents')
  .option('-s, --signature <sig>', 'Inspect specific signature')
  .option('-l, --limit <n>', 'Limit results', '10')
  .option('-j, --json', 'Output as JSON')
  .action((options) => {
    if (options.signature) {
      inspectSingle(options.signature, options.json)
    } else {
      inspectList(parseInt(options.limit), options.json)
    }
  })

interface QuarantineEntry {
  signature: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  category: string
  size: number
  captured: number
  source: string
}

function getQuarantineEntries(limit: number): QuarantineEntry[] {
  // TODO: Connect to real core when available
  void limit
  return []
}

function getEntry(signature: string): QuarantineEntry | null {
  // TODO: Connect to real core when available
  void signature
  return null
}

function inspectSingle(signature: string, json: boolean): void {
  const entry = getEntry(signature)

  if (!entry) {
    console.log(`\n  ❌ Evidence not found: ${signature}\n`)
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

  // Header
  console.log('\n  ╔══════════════════════════════════════════════════════════════╗')
  console.log('  ║                    QUARANTINE CONTENTS                       ║')
  console.log('  ╚══════════════════════════════════════════════════════════════╝\n')

  const table = new Table({
    head: ['Signature', 'Severity', 'Category', 'Size', 'Source'],
    style: { head: ['cyan'], border: ['gray'] },
    colWidths: [16, 12, 12, 12, 18],
  })

  for (const entry of entries) {
    const severityIcon = getSeverityIcon(entry.severity)
    table.push([
      entry.signature.slice(0, 12) + '...',
      `${severityIcon} ${entry.severity}`,
      entry.category,
      formatBytes(entry.size),
      entry.source.slice(0, 15),
    ])
  }

  console.log(table.toString())
  console.log()
}

function printEntry(entry: QuarantineEntry): void {
  const severityIcon = getSeverityIcon(entry.severity)

  // Header
  console.log('\n  ╔══════════════════════════════════════════════════════════════╗')
  console.log('  ║                     EVIDENCE DETAILS                         ║')
  console.log('  ╚══════════════════════════════════════════════════════════════╝\n')

  const table = new Table({
    style: { border: ['gray'] },
  })

  table.push(
    { Signature: entry.signature },
    { Severity: `${severityIcon} ${entry.severity}` },
    { Category: entry.category },
    { Size: formatBytes(entry.size) },
    { Source: entry.source },
    { Captured: new Date(entry.captured).toISOString() }
  )

  console.log(table.toString())
  console.log()
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
