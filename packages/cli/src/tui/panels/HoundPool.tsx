/**
 * Hound Pool Panel - Shows pool status
 */

import { Box, Text } from 'ink'
import React from 'react'

interface HoundPoolData {
  active: number
  dormant: number
  total: number
  exhausted: boolean
}

interface Props {
  data: HoundPoolData
}

export function HoundPoolPanel({ data }: Props): React.ReactElement {
  const healthColor = data.exhausted ? 'red' : data.active === data.total ? 'yellow' : 'green'

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" padding={1} width={25}>
      <Text bold color="cyan">
        HOUND POOL
      </Text>

      <Box marginTop={1}>
        <Text>Status: </Text>
        <Text color={healthColor} bold>
          {data.exhausted ? 'EXHAUSTED' : 'OK'}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color="green">● Active: </Text>
        <Text bold>{data.active}</Text>
      </Box>

      <Box>
        <Text color="gray">○ Dormant: </Text>
        <Text>{data.dormant}</Text>
      </Box>

      <Box>
        <Text>Total: </Text>
        <Text>{data.total}</Text>
      </Box>

      <Box marginTop={1}>
        <Text bold>Utilization:</Text>
      </Box>
      <Box>
        <Text>{renderBar(data.active, data.total)}</Text>
      </Box>
    </Box>
  )
}

function renderBar(current: number, max: number): string {
  const width = 15
  const filled = max > 0 ? Math.round((current / max) * width) : 0
  const empty = width - filled
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`
}
