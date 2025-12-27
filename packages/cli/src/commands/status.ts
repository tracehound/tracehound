/**
 * Status command - Show current system status
 */

import { Command } from 'commander'

export const statusCommand = new Command('status')
  .description('Show current Tracehound system status')
  .option('-j, --json', 'Output as JSON')
  .action((options) => {
    const status = getSystemStatus()

    if (options.json) {
      console.log(JSON.stringify(status, null, 2))
    } else {
      printStatus(status)
    }
  })

interface SystemStatus {
  version: string
  uptime: number
  health: 'healthy' | 'degraded' | 'critical'
  quarantine: {
    count: number
    bytes: number
    capacity: number
  }
  rateLimit: {
    blocked: number
    active: number
  }
  houndPool: {
    active: number
    dormant: number
    total: number
  }
}

function getSystemStatus(): SystemStatus {
  // TODO: Connect to real core when available
  return {
    version: '0.1.0',
    uptime: Math.floor(process.uptime()),
    health: 'healthy',
    quarantine: {
      count: 0,
      bytes: 0,
      capacity: 1000,
    },
    rateLimit: {
      blocked: 0,
      active: 0,
    },
    houndPool: {
      active: 0,
      dormant: 0,
      total: 0,
    },
  }
}

function printStatus(status: SystemStatus): void {
  const healthIcon = status.health === 'healthy' ? '✅' : status.health === 'degraded' ? '⚠️' : '🔴'

  console.log(`
╔════════════════════════════════════════════╗
║            TRACEHOUND STATUS               ║
╠════════════════════════════════════════════╣
║  Version:  ${status.version.padEnd(30)}║
║  Uptime:   ${formatUptime(status.uptime).padEnd(30)}║
║  Health:   ${healthIcon} ${status.health.padEnd(27)}║
╠════════════════════════════════════════════╣
║  QUARANTINE                                ║
║    Count:   ${String(status.quarantine.count).padEnd(29)}║
║    Bytes:   ${formatBytes(status.quarantine.bytes).padEnd(29)}║
║    Cap:     ${String(status.quarantine.capacity).padEnd(29)}║
╠════════════════════════════════════════════╣
║  RATE LIMIT                                ║
║    Blocked: ${String(status.rateLimit.blocked).padEnd(29)}║
║    Active:  ${String(status.rateLimit.active).padEnd(29)}║
╠════════════════════════════════════════════╣
║  HOUND POOL                                ║
║    Active:  ${String(status.houndPool.active).padEnd(29)}║
║    Dormant: ${String(status.houndPool.dormant).padEnd(29)}║
║    Total:   ${String(status.houndPool.total).padEnd(29)}║
╚════════════════════════════════════════════╝
`)
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h}h ${m}m ${s}s`
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}
