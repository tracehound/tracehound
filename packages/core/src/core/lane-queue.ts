/**
 * Lane Queue - Priority-based alert delivery queue.
 *
 * Lanes allow segregating alerts by criticality level with different
 * processing rates and capacity limits.
 *
 * DESIGN:
 * - 4 lanes: critical, high, medium, low
 * - Each lane has independent capacity and rate limits
 * - Higher priority lanes are processed first
 * - Overflow behavior: oldest low-priority alerts are dropped
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

import type { Severity } from '../types/common.js'

/**
 * Alert payload structure.
 */
export interface Alert {
  /** Unique alert ID */
  id: string
  /** Alert severity (determines lane) */
  severity: Severity
  /** Alert type */
  type: 'quarantined' | 'rate_limited' | 'evicted' | 'purged' | 'threshold'
  /** Alert message */
  message: string
  /** Additional context */
  context?: Record<string, unknown>
  /** Creation timestamp */
  timestamp: number
}

/**
 * Lane configuration.
 */
export interface LaneConfig {
  /** Maximum alerts in this lane */
  maxSize: number
  /** Maximum alerts per second (0 = unlimited) */
  rateLimit: number
}

/**
 * Full queue configuration.
 */
export interface LaneQueueConfig {
  /** Lane configurations by severity */
  lanes: Record<Severity, LaneConfig>
  /** What to do when queue is full */
  overflow: 'drop_oldest' | 'drop_lowest' | 'reject'
}

/**
 * Lane statistics.
 */
export interface LaneStats {
  /** Current count per severity */
  counts: Record<Severity, number>
  /** Total dropped alerts */
  dropped: number
  /** Total processed alerts */
  processed: number
}

/**
 * Default configuration.
 */
export const DEFAULT_LANE_CONFIG: LaneQueueConfig = {
  lanes: {
    critical: { maxSize: 1000, rateLimit: 0 }, // Unlimited rate for critical
    high: { maxSize: 500, rateLimit: 100 },
    medium: { maxSize: 200, rateLimit: 50 },
    low: { maxSize: 100, rateLimit: 20 },
  },
  overflow: 'drop_oldest',
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lane Queue implementation.
 */
export class LaneQueue {
  private lanes: Map<Severity, Alert[]> = new Map([
    ['critical', []],
    ['high', []],
    ['medium', []],
    ['low', []],
  ])

  private droppedCount = 0
  private processedCount = 0

  private handlers: ((alert: Alert) => void)[] = []

  constructor(private config: LaneQueueConfig = DEFAULT_LANE_CONFIG) {}

  /**
   * Add an alert to the appropriate lane.
   *
   * @param alert - Alert to enqueue
   * @returns true if enqueued, false if dropped
   */
  enqueue(alert: Alert): boolean {
    const lane = this.lanes.get(alert.severity)!
    const laneConfig = this.config.lanes[alert.severity]

    // Check capacity
    if (lane.length >= laneConfig.maxSize) {
      if (!this.handleOverflow(alert.severity)) {
        this.droppedCount++
        return false
      }
    }

    lane.push(alert)
    return true
  }

  /**
   * Dequeue the next highest priority alert.
   *
   * @returns Next alert or undefined if empty
   */
  dequeue(): Alert | undefined {
    // Process in priority order: critical → high → medium → low
    const priorities: Severity[] = ['critical', 'high', 'medium', 'low']

    for (const severity of priorities) {
      const lane = this.lanes.get(severity)!
      if (lane.length > 0) {
        const alert = lane.shift()!
        this.processedCount++
        return alert
      }
    }

    return undefined
  }

  /**
   * Register an alert handler.
   *
   * @param handler - Function to call for each alert
   */
  onAlert(handler: (alert: Alert) => void): void {
    this.handlers.push(handler)
  }

  /**
   * Process all pending alerts through handlers.
   *
   * @returns Number of alerts processed
   */
  flush(): number {
    let count = 0
    let alert: Alert | undefined

    while ((alert = this.dequeue())) {
      for (const handler of this.handlers) {
        handler(alert)
      }
      count++
    }

    return count
  }

  /**
   * Get current statistics.
   */
  get stats(): LaneStats {
    return {
      counts: {
        critical: this.lanes.get('critical')!.length,
        high: this.lanes.get('high')!.length,
        medium: this.lanes.get('medium')!.length,
        low: this.lanes.get('low')!.length,
      },
      dropped: this.droppedCount,
      processed: this.processedCount,
    }
  }

  /**
   * Get total pending alerts.
   */
  get size(): number {
    return (
      this.lanes.get('critical')!.length +
      this.lanes.get('high')!.length +
      this.lanes.get('medium')!.length +
      this.lanes.get('low')!.length
    )
  }

  /**
   * Handle overflow based on configuration.
   *
   * @returns true if space was made, false otherwise
   */
  private handleOverflow(severity: Severity): boolean {
    switch (this.config.overflow) {
      case 'drop_oldest': {
        const lane = this.lanes.get(severity)!
        if (lane.length > 0) {
          lane.shift()
          this.droppedCount++
          return true
        }
        return false
      }

      case 'drop_lowest': {
        // Drop from lowest non-empty lane
        const priorities: Severity[] = ['low', 'medium', 'high', 'critical']
        for (const p of priorities) {
          const lane = this.lanes.get(p)!
          if (lane.length > 0) {
            lane.shift()
            this.droppedCount++
            return true
          }
        }
        return false
      }

      case 'reject':
        return false
    }
  }
}

/**
 * Create a lane queue.
 *
 * @param config - Optional configuration
 * @returns LaneQueue instance
 */
export function createLaneQueue(config?: Partial<LaneQueueConfig>): LaneQueue {
  const mergedConfig: LaneQueueConfig = {
    ...DEFAULT_LANE_CONFIG,
    ...config,
    lanes: {
      ...DEFAULT_LANE_CONFIG.lanes,
      ...config?.lanes,
    },
  }

  return new LaneQueue(mergedConfig)
}
