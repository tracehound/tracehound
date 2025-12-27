/**
 * Quarantine Panel - Shows quarantine status
 */

import { Box, Text } from 'ink'
import React from 'react'

interface QuarantineData {
  count: number
  bytes: number
  capacity: number
  bySeverity: {
    critical: number
    high: number
    medium: number
    low: number
  }
}

interface Props {
  data: QuarantineData
}

export function QuarantinePanel({ data }: Props): React.ReactElement {
  const usage = data.capacity > 0 ? (data.count / data.capacity) * 100 : 0
  const usageColor = usage > 90 ? 'red' : usage > 70 ? 'yellow' : 'green'

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" padding={1} width={30}>
      <Text bold color="cyan">
        QUARANTINE
      </Text>

      <Box marginTop={1}>
        <Text>Count: </Text>
        <Text color={usageColor} bold>
          {data.count}
        </Text>
        <Text color="gray"> / {data.capacity}</Text>
      </Box>

      <Box>
        <Text>Usage: </Text>
        <Text color={usageColor}>{usage.toFixed(1)}%</Text>
      </Box>

      <Box>
        <Text>Bytes: </Text>
        <Text>{formatBytes(data.bytes)}</Text>
      </Box>

      <Box marginTop={1}>
        <Text bold>By Severity:</Text>
      </Box>
      <Box>
        <Text color="red">● {data.bySeverity.critical} </Text>
        <Text color="yellow">● {data.bySeverity.high} </Text>
        <Text color="cyan">● {data.bySeverity.medium} </Text>
        <Text color="green">● {data.bySeverity.low}</Text>
      </Box>
    </Box>
  )
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}
