/**
 * Audit Panel - Shows audit chain status
 */

import { Box, Text } from 'ink'
import React from 'react'

interface AuditData {
  records: number
  lastHash: string
  integrity: 'valid' | 'invalid' | 'empty'
}

interface Props {
  data: AuditData
}

export function AuditPanel({ data }: Props): React.ReactElement {
  const integrityColor = data.integrity === 'valid' ? 'green' : data.integrity === 'invalid' ? 'red' : 'gray'

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" padding={1} width={25}>
      <Text bold color="cyan">
        AUDIT CHAIN
      </Text>

      <Box marginTop={1}>
        <Text>Records: </Text>
        <Text bold>{data.records}</Text>
      </Box>

      <Box marginTop={1}>
        <Text>Integrity: </Text>
        <Text color={integrityColor} bold>
          {data.integrity.toUpperCase()}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text bold>Last Hash:</Text>
      </Box>
      <Box>
        <Text color="gray">{data.lastHash.slice(0, 16) || '(empty)'}...</Text>
      </Box>
    </Box>
  )
}
