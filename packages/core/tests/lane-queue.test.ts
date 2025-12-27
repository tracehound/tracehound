/**
 * Lane Queue tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLaneQueue, LaneQueue, type Alert } from '../src/core/lane-queue.js'

describe('LaneQueue', () => {
  let queue: LaneQueue

  beforeEach(() => {
    queue = createLaneQueue()
  })

  function createAlert(severity: Alert['severity'], id = `alert-${Date.now()}`): Alert {
    return {
      id,
      severity,
      type: 'quarantined',
      message: 'Test alert',
      timestamp: Date.now(),
    }
  }

  describe('enqueue', () => {
    it('should enqueue alerts', () => {
      const alert = createAlert('high')
      const result = queue.enqueue(alert)

      expect(result).toBe(true)
      expect(queue.size).toBe(1)
    })

    it('should track counts by severity', () => {
      queue.enqueue(createAlert('critical'))
      queue.enqueue(createAlert('high'))
      queue.enqueue(createAlert('medium'))
      queue.enqueue(createAlert('low'))

      expect(queue.stats.counts.critical).toBe(1)
      expect(queue.stats.counts.high).toBe(1)
      expect(queue.stats.counts.medium).toBe(1)
      expect(queue.stats.counts.low).toBe(1)
    })
  })

  describe('dequeue', () => {
    it('should dequeue in priority order', () => {
      queue.enqueue(createAlert('low', 'low-1'))
      queue.enqueue(createAlert('critical', 'critical-1'))
      queue.enqueue(createAlert('medium', 'medium-1'))
      queue.enqueue(createAlert('high', 'high-1'))

      expect(queue.dequeue()?.id).toBe('critical-1')
      expect(queue.dequeue()?.id).toBe('high-1')
      expect(queue.dequeue()?.id).toBe('medium-1')
      expect(queue.dequeue()?.id).toBe('low-1')
    })

    it('should return undefined when empty', () => {
      expect(queue.dequeue()).toBeUndefined()
    })

    it('should track processed count', () => {
      queue.enqueue(createAlert('high'))
      queue.enqueue(createAlert('high'))
      queue.dequeue()
      queue.dequeue()

      expect(queue.stats.processed).toBe(2)
    })
  })

  describe('overflow handling', () => {
    it('should handle drop_oldest overflow', () => {
      const smallQueue = createLaneQueue({
        lanes: {
          critical: { maxSize: 2, rateLimit: 0 },
          high: { maxSize: 2, rateLimit: 0 },
          medium: { maxSize: 2, rateLimit: 0 },
          low: { maxSize: 2, rateLimit: 0 },
        },
        overflow: 'drop_oldest',
      })

      smallQueue.enqueue(createAlert('high', 'h1'))
      smallQueue.enqueue(createAlert('high', 'h2'))
      smallQueue.enqueue(createAlert('high', 'h3')) // Should drop h1

      expect(smallQueue.size).toBe(2)
      expect(smallQueue.stats.dropped).toBe(1)
    })

    it('should handle reject overflow', () => {
      const rejectQueue = createLaneQueue({
        lanes: {
          critical: { maxSize: 1, rateLimit: 0 },
          high: { maxSize: 1, rateLimit: 0 },
          medium: { maxSize: 1, rateLimit: 0 },
          low: { maxSize: 1, rateLimit: 0 },
        },
        overflow: 'reject',
      })

      rejectQueue.enqueue(createAlert('high', 'h1'))
      const result = rejectQueue.enqueue(createAlert('high', 'h2'))

      expect(result).toBe(false)
      expect(rejectQueue.stats.dropped).toBe(1)
    })
  })

  describe('handlers', () => {
    it('should call handlers on flush', () => {
      const handler = vi.fn()
      queue.onAlert(handler)

      queue.enqueue(createAlert('high'))
      queue.enqueue(createAlert('low'))
      queue.flush()

      expect(handler).toHaveBeenCalledTimes(2)
    })
  })
})
