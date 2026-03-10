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

    it('should drop a new task when MAX_SCHEDULED_TASKS is reached and warn', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // Fill to capacity (256 unique IDs)
      for (let i = 0; i < 256; i++) {
        scheduler.schedule({ id: `task-cap-${i}`, execute: () => {}, intervalMs: 100 })
      }
      expect(scheduler.stats.scheduledTasks).toBe(256)

      // 257th unique ID must be dropped
      scheduler.schedule({ id: 'task-overflow', execute: () => {}, intervalMs: 100 })
      expect(scheduler.stats.scheduledTasks).toBe(256)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('task "task-overflow" dropped'),
      )

      consoleSpy.mockRestore()
    })

    it('should allow rescheduling an existing task ID even when at capacity', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const original = vi.fn()

      scheduler.schedule({ id: 'task-cap-0', execute: original, intervalMs: 100 })
      for (let i = 1; i < 256; i++) {
        scheduler.schedule({ id: `task-cap-${i}`, execute: () => {}, intervalMs: 100 })
      }

      // Rescheduling an existing ID must not be dropped and must not warn
      const updated = vi.fn()
      scheduler.schedule({ id: 'task-cap-0', execute: updated, intervalMs: 200 })
      expect(scheduler.stats.scheduledTasks).toBe(256)
      expect(consoleSpy).not.toHaveBeenCalled()

      scheduler.start()
      vi.advanceTimersByTime(250)
      expect(updated).toHaveBeenCalled()
      expect(original).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
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

  describe('Drop and Count', () => {
    it('sheds and counts due tasks above maxTasksPerTick', () => {
      scheduler.stop()
      scheduler = createScheduler({
        tickInterval: 100,
        jitterMs: 0,
        maxTasksPerTick: 1,
      })

      let executed = 0
      scheduler.schedule({
        id: 'task-a',
        execute: () => {
          executed++
        },
        intervalMs: 10,
        priority: 1,
      })
      scheduler.schedule({
        id: 'task-b',
        execute: () => {
          executed++
        },
        intervalMs: 10,
        priority: 1,
      })
      scheduler.schedule({
        id: 'task-c',
        execute: () => {
          executed++
        },
        intervalMs: 10,
        priority: 1,
      })

      scheduler.start()
      vi.advanceTimersByTime(100)

      expect(executed).toBe(1)
      expect(scheduler.stats.droppedTasks).toBe(2)
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

  describe('Injectable RNG and clock', () => {
    it('should use injected _randomInt for jitter instead of crypto.randomInt', () => {
      const calls: Array<[number, number]> = []
      const injectedRng = (min: number, max: number): number => {
        calls.push([min, max])
        return 0 // always zero jitter
      }

      scheduler.stop()
      scheduler = createScheduler({
        tickInterval: 100,
        jitterMs: 50,
        _randomInt: injectedRng,
      })
      scheduler.start()
      vi.advanceTimersByTime(300)

      // The injected RNG should have been called with correct bounds
      expect(calls.length).toBeGreaterThan(0)
      for (const [min, max] of calls) {
        expect(min).toBe(0)
        expect(max).toBe(51) // Math.floor(50) + 1
      }
    })

    it('should produce deterministic jitter=0 with _randomInt returning 0', () => {
      scheduler.stop()
      scheduler = createScheduler({
        tickInterval: 100,
        jitterMs: 50,
        skipIfBusy: false,
        _randomInt: () => 0, // always zero jitter
      })

      let executions = 0
      scheduler.schedule({ id: 'det', execute: () => { executions++ }, intervalMs: 100 })
      scheduler.start()

      // With jitter=0, tick fires at exactly 100ms each time
      vi.advanceTimersByTime(100)
      expect(executions).toBe(1)
      vi.advanceTimersByTime(100)
      expect(executions).toBe(2)
    })

    it('should use injected _now for task interval tracking', () => {
      let fakeTime = 1_000_000
      const mockNow = (): number => fakeTime

      scheduler.stop()
      scheduler = createScheduler({
        tickInterval: 100,
        jitterMs: 0,
        skipIfBusy: false,
        _now: mockNow,
      })

      let executions = 0
      scheduler.schedule({ id: 'clock-test', execute: () => { executions++ }, intervalMs: 500 })
      scheduler.start()

      // First tick: fakeTime=1_000_000, task lastExecuted=0 → elapsed=1_000_000 >= 500 → runs
      vi.advanceTimersByTime(100)
      expect(executions).toBe(1)

      // Advance fake clock by less than intervalMs → task not due
      fakeTime += 100
      vi.advanceTimersByTime(100)
      expect(executions).toBe(1)

      // Advance fake clock past intervalMs → task due
      fakeTime += 500
      vi.advanceTimersByTime(100)
      expect(executions).toBe(2)
    })
  })
})
