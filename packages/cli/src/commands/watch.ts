/**
 * Watch command - Live TUI dashboard
 */

import { Command } from 'commander'
import { render } from 'ink'
import React from 'react'
import { App } from '../tui/App.js'

export const watchCommand = new Command('watch')
  .description('Launch live TUI dashboard')
  .option('-r, --refresh <ms>', 'Refresh interval in ms', '1000')
  .action((options) => {
    const refreshMs = parseInt(options.refresh)

    console.clear()
    render(React.createElement(App, { refreshMs }))
  })
