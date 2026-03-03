/**
 * Disk command - explicit physical cleanup controls for trace registry storage.
 */

import { clearTraceRegistryDisk, getTraceRegistryStats } from '@tracehound/core'
import Table from 'cli-table3'
import { Command } from 'commander'

export const diskCommand = new Command('disk').description('Manage trace registry disk state')

diskCommand
  .addCommand(
    new Command('clear')
      .description('Delete trace registry file from disk')
      .option('-j, --json', 'Output as JSON')
      .action((options) => {
        const before = getTraceRegistryStats()
        const cleared = clearTraceRegistryDisk()
        const after = getTraceRegistryStats()

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                ...cleared,
                before: snapshot(before),
                after: snapshot(after),
              },
              null,
              2,
            ),
          )
          return
        }

        const table = new Table({
          head: ['DISK CLEAR', 'Value'],
          style: { head: ['cyan'], border: ['gray'] },
        })

        table.push(
          ['Result', cleared.success ? 'success' : 'failed'],
          ['Path', cleared.path],
          ['Removed Entries', String(cleared.removedEntries)],
          ['Removed Bytes', formatBytes(cleared.removedBytes)],
          ['File Exists After', after.fileExists ? 'yes' : 'no'],
          ['Disk After', formatBytes(after.fileBytes)],
        )

        console.log('\n' + table.toString() + '\n')
      }),
  )

function snapshot(stats: ReturnType<typeof getTraceRegistryStats>) {
  return {
    fileExists: stats.fileExists,
    retainedEntries: stats.retainedEntries,
    fileBytes: stats.fileBytes,
    droppedCount: stats.droppedCount,
    queueDepth: stats.queueDepth,
    blocked: stats.blocked,
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}
