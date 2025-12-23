/**
 * Tick Scheduler tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createScheduler, type IScheduler } from '../src/core/scheduler.js'

describe('Scheduler', () => {
  let scheduler: IScheduler

  beforeEach(() => {
    vi.useFakeTimers()
    scheduler = createScheduler({
      tickInterval: 100,
      jitterMs: 10,
    })
  })

  afterEach(() => {
    scheduler.stop()
    vi.useRealTimers()
  })

  describe('Construction', () => {
    it('starts in stopped state', () => {
      expect(scheduler.stats.running).toBe(false)
    })

    it('skipIfBusy defaults to true', () => {
      // Verify by behavior - when busy checker returns true, ticks skip
      let executions = 0
      scheduler.schedule({
        id: 'test',
        execute: () => {
          executions++
        },
        intervalMs: 50,
      })

      scheduler.setBusyChecker(() => true) // Always busy
      scheduler.start()

      vi.advanceTimersByTime(500)

      // Should have skipped all ticks
      expect(scheduler.stats.skippedTicks).toBeGreaterThan(0)
      expect(executions).toBe(0)
    })

    it('skipIfBusy can be disabled', () => {
      scheduler.stop()
      scheduler = createScheduler({
        tickInterval: 100,
        jitterMs: 10,
        skipIfBusy: false,
      })

      let executions = 0
      scheduler.schedule({
        id: 'test',
        execute: () => {
          executions++
        },
        intervalMs: 50,
      })

      scheduler.setBusyChecker(() => true) // Always busy
      scheduler.start()

      vi.advanceTimersByTime(500)

      // Should have executed despite being busy
      expect(executions).toBeGreaterThan(0)
    })
  })

  describe('start() / stop()', () => {
    it('start begins tick cycle', () => {
      scheduler.start()

      expect(scheduler.stats.running).toBe(true)
    })

    it('stop halts tick cycle', () => {
      scheduler.start()
      scheduler.stop()

      expect(scheduler.stats.running).toBe(false)
    })

    it('multiple start calls are idempotent', () => {
      scheduler.start()
      scheduler.start()
      scheduler.start()

      expect(scheduler.stats.running).toBe(true)
    })
  })

  describe('schedule()', () => {
    it('adds task to scheduled tasks', () => {
      scheduler.schedule({
        id: 'task-1',
        execute: () => {},
        intervalMs: 100,
      })

      expect(scheduler.stats.scheduledTasks).toBe(1)
    })

    it('executes task at interval', () => {
      let executions = 0
      scheduler.schedule({
        id: 'counter',
        execute: () => {
          executions++
        },
        intervalMs: 100,
      })

      scheduler.start()

      // After 500ms, should execute ~4-5 times (100ms + jitter)
      vi.advanceTimersByTime(500)

      expect(executions).toBeGreaterThan(0)
    })

    it('multiple tasks execute independently', () => {
      let task1Count = 0
      let task2Count = 0

      scheduler.schedule({
        id: 'task-1',
        execute: () => {
          task1Count++
        },
        intervalMs: 100,
      })

      scheduler.schedule({
        id: 'task-2',
        execute: () => {
          task2Count++
        },
        intervalMs: 100,
      })

      scheduler.start()
      vi.advanceTimersByTime(500)

      expect(task1Count).toBeGreaterThan(0)
      expect(task2Count).toBeGreaterThan(0)
    })
  })

  describe('unschedule()', () => {
    it('removes task from scheduled tasks', () => {
      scheduler.schedule({
        id: 'to-remove',
        execute: () => {},
        intervalMs: 100,
      })

      expect(scheduler.stats.scheduledTasks).toBe(1)

      scheduler.unschedule('to-remove')

      expect(scheduler.stats.scheduledTasks).toBe(0)
    })

    it('stops task execution', () => {
      let executions = 0
      scheduler.schedule({
        id: 'counter',
        execute: () => {
          executions++
        },
        intervalMs: 50,
      })

      scheduler.start()
      vi.advanceTimersByTime(200)
      const countBeforeUnschedule = executions

      scheduler.unschedule('counter')
      vi.advanceTimersByTime(200)

      expect(executions).toBe(countBeforeUnschedule)
    })
  })

  describe('Priority', () => {
    it('executes higher priority tasks first', () => {
      const executionOrder: string[] = []

      scheduler.schedule({
        id: 'low',
        execute: () => {
          executionOrder.push('low')
        },
        intervalMs: 50,
        priority: 10, // Lower priority
      })

      scheduler.schedule({
        id: 'high',
        execute: () => {
          executionOrder.push('high')
        },
        intervalMs: 50,
        priority: 1, // Higher priority
      })

      scheduler.start()
      vi.advanceTimersByTime(150)

      // High priority should execute first in each tick
      expect(executionOrder.filter((t) => t === 'high').length).toBeGreaterThan(0)
      expect(executionOrder[0]).toBe('high')
    })
  })

  describe('Error handling', () => {
    it('continues after sync task error', () => {
      let successCount = 0

      scheduler.schedule({
        id: 'error-task',
        execute: () => {
          throw new Error('Boom!')
        },
        intervalMs: 50,
      })

      scheduler.schedule({
        id: 'success-task',
        execute: () => {
          successCount++
        },
        intervalMs: 50,
      })

      scheduler.start()
      vi.advanceTimersByTime(200)

      // Should continue executing despite errors
      expect(successCount).toBeGreaterThan(0)
    })

    it('continues after async task rejection', async () => {
      let successCount = 0

      scheduler.schedule({
        id: 'async-error',
        execute: async () => {
          throw new Error('Async boom!')
        },
        intervalMs: 50,
      })

      scheduler.schedule({
        id: 'success',
        execute: () => {
          successCount++
        },
        intervalMs: 50,
      })

      scheduler.start()
      await vi.advanceTimersByTimeAsync(200)

      expect(successCount).toBeGreaterThan(0)
    })
  })

  describe('Stats', () => {
    it('tracks totalTicks', () => {
      scheduler.start()
      vi.advanceTimersByTime(500)

      expect(scheduler.stats.totalTicks).toBeGreaterThan(0)
    })

    it('tracks totalTasksExecuted', () => {
      scheduler.schedule({
        id: 'test',
        execute: () => {},
        intervalMs: 50,
      })

      scheduler.start()
      vi.advanceTimersByTime(200)

      expect(scheduler.stats.totalTasksExecuted).toBeGreaterThan(0)
    })

    it('tracks skippedTicks when busy', () => {
      scheduler.setBusyChecker(() => true)

      scheduler.start()
      vi.advanceTimersByTime(500)

      expect(scheduler.stats.skippedTicks).toBeGreaterThan(0)
    })

    it('stats are immutable snapshots', () => {
      const stats1 = scheduler.stats

      scheduler.start()
      vi.advanceTimersByTime(200)

      const stats2 = scheduler.stats

      expect(stats1.totalTicks).toBe(0)
      expect(stats2.totalTicks).toBeGreaterThan(0)
    })
  })
})
