/**
 * Tick Scheduler - jittered task scheduling for background operations.
 *
 * RFC-0000 CRITICAL INVARIANTS:
 * - skipIfBusy: true by default (prevents timing attacks)
 * - Jitter applied to all ticks (prevents predictable patterns)
 * - No blocking of hot-path
 */

/**
 * Scheduled task definition.
 */
export interface ScheduledTask {
  /** Unique task identifier */
  id: string
  /** Task execution function */
  execute: () => void | Promise<void>
  /** Interval between executions in ms */
  intervalMs: number
  /** Priority (lower = higher priority) */
  priority?: number
}

/**
 * Tick Scheduler configuration.
 */
export interface TickSchedulerConfig {
  /** Base tick interval in ms */
  tickInterval: number
  /** Maximum jitter range in ms (added to tick interval) */
  jitterMs: number
  /**
   * Skip tick if system is busy.
   * DEFAULT: true (RFC requirement for timing attack prevention)
   */
  skipIfBusy?: boolean
}

/**
 * Scheduler statistics (immutable snapshot).
 */
export interface SchedulerStats {
  /** Total ticks executed */
  totalTicks: number
  /** Total tasks executed */
  totalTasksExecuted: number
  /** Total ticks skipped (due to busy) */
  skippedTicks: number
  /** Number of scheduled tasks */
  scheduledTasks: number
  /** Whether scheduler is running */
  running: boolean
  /** Whether system is currently busy */
  busy: boolean
}

/**
 * Busy check function type.
 * Returns true if system is busy.
 */
export type BusyChecker = () => boolean

/**
 * Scheduler interface.
 */
export interface IScheduler {
  /**
   * Start the scheduler.
   */
  start(): void

  /**
   * Stop the scheduler.
   */
  stop(): void

  /**
   * Schedule a task.
   *
   * @param task - Task definition
   */
  schedule(task: ScheduledTask): void

  /**
   * Unschedule a task by ID.
   *
   * @param taskId - Task ID to remove
   */
  unschedule(taskId: string): void

  /**
   * Set busy checker function.
   * Used to determine if ticks should be skipped.
   *
   * @param checker - Function that returns true if busy
   */
  setBusyChecker(checker: BusyChecker): void

  /**
   * Get scheduler statistics (immutable snapshot).
   */
  readonly stats: Readonly<SchedulerStats>
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal task state.
 */
interface TaskState {
  task: ScheduledTask
  lastExecuted: number
}

/**
 * Tick Scheduler implementation.
 */
export class Scheduler implements IScheduler {
  private readonly tasks: Map<string, TaskState> = new Map()
  private tickTimeoutId: ReturnType<typeof setTimeout> | null = null
  private busyChecker: BusyChecker = () => false
  private _running = false
  private _busy = false

  // Statistics
  private _totalTicks = 0
  private _totalTasksExecuted = 0
  private _skippedTicks = 0

  // Config with defaults
  private readonly skipIfBusy: boolean

  constructor(private readonly config: TickSchedulerConfig) {
    // skipIfBusy defaults to true (RFC requirement)
    this.skipIfBusy = config.skipIfBusy ?? true
  }

  start(): void {
    if (this._running) return
    this._running = true
    this.scheduleTick()
  }

  stop(): void {
    if (!this._running) return
    this._running = false

    if (this.tickTimeoutId) {
      clearTimeout(this.tickTimeoutId)
      this.tickTimeoutId = null
    }
  }

  schedule(task: ScheduledTask): void {
    this.tasks.set(task.id, {
      task,
      lastExecuted: 0,
    })
  }

  unschedule(taskId: string): void {
    this.tasks.delete(taskId)
  }

  setBusyChecker(checker: BusyChecker): void {
    this.busyChecker = checker
  }

  get stats(): Readonly<SchedulerStats> {
    return Object.freeze({
      totalTicks: this._totalTicks,
      totalTasksExecuted: this._totalTasksExecuted,
      skippedTicks: this._skippedTicks,
      scheduledTasks: this.tasks.size,
      running: this._running,
      busy: this._busy,
    })
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  private scheduleTick(): void {
    if (!this._running) return

    // Apply jitter to interval
    const jitter = Math.random() * this.config.jitterMs
    const delay = this.config.tickInterval + jitter

    this.tickTimeoutId = setTimeout(() => {
      this.executeTick()
    }, delay)
  }

  private executeTick(): void {
    if (!this._running) return

    this._totalTicks++

    // Check if system is busy
    this._busy = this.busyChecker()

    if (this.skipIfBusy && this._busy) {
      this._skippedTicks++
      this.scheduleTick()
      return
    }

    // Execute due tasks
    const now = Date.now()
    const dueTasks = this.getDueTasks(now)

    // Sort by priority
    dueTasks.sort((a, b) => (a.task.priority ?? 100) - (b.task.priority ?? 100))

    for (const taskState of dueTasks) {
      this.executeTask(taskState, now)
    }

    // Schedule next tick
    this.scheduleTick()
  }

  private getDueTasks(now: number): TaskState[] {
    const dueTasks: TaskState[] = []

    for (const [, taskState] of this.tasks) {
      const elapsed = now - taskState.lastExecuted
      if (elapsed >= taskState.task.intervalMs) {
        dueTasks.push(taskState)
      }
    }

    return dueTasks
  }

  private executeTask(taskState: TaskState, now: number): void {
    taskState.lastExecuted = now
    this._totalTasksExecuted++

    try {
      const result = taskState.task.execute()

      // Handle async tasks (fire-and-forget)
      if (result instanceof Promise) {
        result.catch(() => {
          // Silently ignore task errors
        })
      }
    } catch {
      // Silently ignore task errors
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Scheduler instance.
 *
 * @param config - Scheduler configuration
 */
export function createScheduler(config: TickSchedulerConfig): IScheduler {
  return new Scheduler(config)
}
