/**
 * TUI Application - Main Ink component
 */

import { Box, Text } from 'ink'
import React, { useEffect, useState } from 'react'
import { useSnapshot } from './hooks/useSnapshot.js'
import { AuditPanel } from './panels/Audit.js'
import { HoundPoolPanel } from './panels/HoundPool.js'
import { QuarantinePanel } from './panels/Quarantine.js'

interface AppProps {
  refreshMs: number
}

export function App({ refreshMs }: AppProps): React.ReactElement {
  const snapshot = useSnapshot(refreshMs)
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          ╔══════════════════════════════════════════════════════════════════════╗
        </Text>
      </Box>
      <Box>
        <Text bold color="cyan">
          ║
        </Text>
        <Text bold color="white">
          {' '}
          TRACEHOUND LIVE{' '}
        </Text>
        <Text color="gray">{time.toISOString()}</Text>
        <Text bold color="cyan">
          {'                              '}║
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          ╚══════════════════════════════════════════════════════════════════════╝
        </Text>
      </Box>

      {/* Panels */}
      <Box flexDirection="row" gap={2}>
        <QuarantinePanel data={snapshot.quarantine} />
        <HoundPoolPanel data={snapshot.houndPool} />
        <AuditPanel data={snapshot.audit} />
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text color="gray">Press Ctrl+C to exit | Refresh: {refreshMs}ms</Text>
      </Box>
    </Box>
  )
}
