/**
 * History command - explicit logical cleanup controls for trace inspection data.
 */

import { clearTraceInspectionHistory, getTraceRegistryStats } from '@tracehound/core'
import Table from 'cli-table3'
import { Command } from 'commander'

export const historyCommand = new Command('history')
  .description('Manage trace inspection history')

historyCommand
  .addCommand(
    new Command('clear')
      .description('Clear trace inspection history while preserving registry file')
      .option('-j, --json', 'Output as JSON')
      .action((options) => {
        const before = getTraceRegistryStats()
        const cleared = clearTraceInspectionHistory()
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
          head: ['HISTORY CLEAR', 'Value'],
          style: { head: ['yellow'], border: ['gray'] },
        })

        table.push(
          ['Result', cleared.success ? 'success' : 'failed'],
          ['Path', cleared.path],
          ['Removed Entries', String(cleared.removedEntries)],
          ['Removed Bytes', formatBytes(cleared.removedBytes)],
          ['Entries After', String(after.retainedEntries)],
          ['Disk After', formatBytes(after.fileBytes)],
        )

        console.log('\n' + table.toString() + '\n')
      }),
  )

function snapshot(stats: ReturnType<typeof getTraceRegistryStats>) {
  return {
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
