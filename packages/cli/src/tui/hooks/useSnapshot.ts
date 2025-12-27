/**
 * useSnapshot hook - Fetches system snapshot at interval
 */

import { useEffect, useState } from 'react'

export interface Snapshot {
  quarantine: {
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
  houndPool: {
    active: number
    dormant: number
    total: number
    exhausted: boolean
  }
  audit: {
    records: number
    lastHash: string
    integrity: 'valid' | 'invalid' | 'empty'
  }
}

function getSnapshot(): Snapshot {
  // TODO: Connect to real core when available
  return {
    quarantine: {
      count: 0,
      bytes: 0,
      capacity: 1000,
      bySeverity: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      },
    },
    houndPool: {
      active: 0,
      dormant: 0,
      total: 0,
      exhausted: false,
    },
    audit: {
      records: 0,
      lastHash: '',
      integrity: 'empty',
    },
  }
}

export function useSnapshot(refreshMs: number): Snapshot {
  const [snapshot, setSnapshot] = useState<Snapshot>(getSnapshot)

  useEffect(() => {
    const interval = setInterval(() => {
      setSnapshot(getSnapshot())
    }, refreshMs)

    return () => clearInterval(interval)
  }, [refreshMs])

  return snapshot
}
