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

const program = new Command()

program.name('tracehound').description('Tracehound CLI - Runtime Security Buffer').version('0.1.0')

// Register commands
program.addCommand(statusCommand)
program.addCommand(statsCommand)
program.addCommand(inspectCommand)
program.addCommand(watchCommand)

program.parse()
