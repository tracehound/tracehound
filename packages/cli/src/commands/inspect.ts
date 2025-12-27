/**
 * Inspect command - Inspect quarantine contents
 */

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
    console.log(`❌ Evidence not found: ${signature}`)
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
    console.log('📭 Quarantine is empty')
    return
  }

  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                    QUARANTINE CONTENTS                         ║
╠══════════════╦══════════╦══════════╦═══════════╦═══════════════╣
║  Signature   ║ Severity ║ Category ║   Size    ║    Source     ║
╠══════════════╬══════════╬══════════╬═══════════╬═══════════════╣`)

  for (const entry of entries) {
    const sig = entry.signature.slice(0, 10) + '...'
    const sev = entry.severity.padEnd(8)
    const cat = entry.category.padEnd(8)
    const size = formatBytes(entry.size).padEnd(9)
    const src = entry.source.slice(0, 13).padEnd(13)
    console.log(`║  ${sig}  ║ ${sev} ║ ${cat} ║ ${size} ║ ${src} ║`)
  }

  console.log('╚══════════════╩══════════╩══════════╩═══════════╩═══════════════╝')
}

function printEntry(entry: QuarantineEntry): void {
  const severityIcon =
    entry.severity === 'critical'
      ? '🔴'
      : entry.severity === 'high'
      ? '🟠'
      : entry.severity === 'medium'
      ? '🟡'
      : '🟢'

  console.log(`
╔════════════════════════════════════════════╗
║             EVIDENCE DETAILS               ║
╠════════════════════════════════════════════╣
║  Signature: ${entry.signature.slice(0, 28).padEnd(28)}  ║
║  Severity:  ${severityIcon} ${entry.severity.padEnd(25)}║
║  Category:  ${entry.category.padEnd(28)}  ║
║  Size:      ${formatBytes(entry.size).padEnd(28)}  ║
║  Source:    ${entry.source.padEnd(28)}  ║
║  Captured:  ${new Date(entry.captured).toISOString().padEnd(28)}║
╚════════════════════════════════════════════╝
`)
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}
