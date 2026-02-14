#!/usr/bin/env node
/**
 * Tracehound CLI - Evaluation Runtime
 *
 * Commands:
 * - tracehound status     : Show current system status
 * - tracehound stats      : Show threat statistics
 * - tracehound inspect    : Inspect quarantine
 * - tracehound watch      : Live TUI dashboard
 */

import { Command } from 'commander'
import { inspectCommand } from './commands/inspect.js'
import { statsCommand } from './commands/stats.js'
import { statusCommand } from './commands/status.js'
import { watchCommand } from './commands/watch.js'

import { fileURLToPath } from 'url'

import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { version } = require('../package.json')

export const program = new Command()

program.name('tracehound').description('Tracehound CLI - Runtime Security Buffer').version(version)

// Register commands
program.addCommand(statusCommand)
program.addCommand(statsCommand)
program.addCommand(inspectCommand)
program.addCommand(watchCommand)

// Only parse if executed directly
const isMain =
  process.argv[1] && fileURLToPath(import.meta.url).endsWith(process.argv[1].replace(/\\/g, '/'))

if (isMain || process.env.NODE_ENV === 'cli-run') {
  program.parse()
}
