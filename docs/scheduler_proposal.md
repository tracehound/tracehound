## Tracehound System Scheduler Proposal

```typescript
interface TickSchedulerConfig {
  auditLog: (entry: AuditEntry) => void
  onTaskFailure?: (id: string, error: Error, consecutive: number) => void
}

class JitteredTickScheduler {
  private tasks = new Map<string, ScheduledTask>()
  private timers = new Map<string, NodeJS.Timeout>()

  constructor(private config: TickSchedulerConfig) {}

  schedule(
    id: string,
    fn: () => Promise<void>,
    options: {
      intervalMs: number
      jitterMs: number
      critical?: boolean
    }
  ): void {
    if (this.tasks.has(id)) {
      throw new Error(`Task ${id} already scheduled`)
    }

    const task: ScheduledTask = {
      id,
      fn,
      intervalMs: options.intervalMs,
      jitterMs: options.jitterMs,
      critical: options.critical ?? false,
      nextRun: this._getNextRun(options.intervalMs, options.jitterMs),
      lastRun: null,
      running: false,
      consecutiveFailures: 0,
    }

    this.tasks.set(id, task)
    this._scheduleNext(task)

    this.config.auditLog({
      type: 'scheduler.task_scheduled',
      taskId: id,
      intervalMs: options.intervalMs,
      timestamp: Date.now(),
    })
  }

  private _getNextRun(intervalMs: number, jitterMs: number): number {
    const jitter = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0
    return process.hrtime.bigint() + BigInt((intervalMs + jitter) * 1_000_000)
  }

  private _scheduleNext(task: ScheduledTask): void {
    const now = process.hrtime.bigint()
    const delay = Math.max(0, Number((task.nextRun - now) / 1_000_000n))

    const timer = setTimeout(() => this._execute(task), delay)
    this.timers.set(task.id, timer)
  }

  private async _execute(task: ScheduledTask): Promise<void> {
    // Backpressure: skip if previous still running
    if (task.running) {
      this.config.auditLog({
        type: 'scheduler.execution_skipped',
        taskId: task.id,
        reason: 'previous_still_running',
        timestamp: Date.now(),
      })

      // Schedule next anyway
      task.nextRun = this._getNextRun(task.intervalMs, task.jitterMs)
      this._scheduleNext(task)
      return
    }

    task.running = true
    const startTime = process.hrtime.bigint()

    try {
      await task.fn()

      const duration = Number((process.hrtime.bigint() - startTime) / 1_000_000n)

      task.consecutiveFailures = 0
      task.lastRun = Number(process.hrtime.bigint())

      this.config.auditLog({
        type: 'scheduler.task_success',
        taskId: task.id,
        durationMs: duration,
        timestamp: Date.now(),
      })
    } catch (err) {
      task.consecutiveFailures++

      this.config.auditLog({
        type: 'scheduler.task_failure',
        taskId: task.id,
        error: err instanceof Error ? err.message : String(err),
        consecutiveFailures: task.consecutiveFailures,
        timestamp: Date.now(),
      })

      // Alert on failure, but DON'T make decisions (no circuit breaker)
      if (this.config.onTaskFailure) {
        this.config.onTaskFailure(task.id, err as Error, task.consecutiveFailures)
      }

      // Critical failure → emergency alert only, scheduler continues
      if (task.critical && task.consecutiveFailures >= 3) {
        this.config.auditLog({
          type: 'scheduler.critical_failure',
          taskId: task.id,
          consecutiveFailures: task.consecutiveFailures,
          timestamp: Date.now(),
        })
      }
    } finally {
      task.running = false
    }

    // Continue scheduling if task still exists
    if (this.tasks.has(task.id)) {
      task.nextRun = this._getNextRun(task.intervalMs, task.jitterMs)
      self._scheduleNext(task)
    }
  }

  unschedule(id: string): void {
    const timer = this.timers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(id)
    }

    this.tasks.delete(id)

    this.config.auditLog({
      type: 'scheduler.task_unscheduled',
      taskId: id,
      timestamp: Date.now(),
    })
  }

  shutdown(): void {
    this.config.auditLog({
      type: 'scheduler.shutdown',
      activeTasks: this.tasks.size,
      timestamp: Date.now(),
    })

    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }

    this.tasks.clear()
    this.timers.clear()
  }

  // Observable state for Watcher (RFC-0001)
  getState(): ReadonlyArray<TaskState> {
    return Array.from(this.tasks.values()).map((task) => ({
      id: task.id,
      intervalMs: task.intervalMs,
      nextRun: Number(task.nextRun / 1_000_000n),
      lastRun: task.lastRun,
      running: task.running,
      consecutiveFailures: task.consecutiveFailures,
      critical: task.critical,
    }))
  }
}

interface ScheduledTask {
  id: string
  fn: () => Promise<void>
  intervalMs: number
  jitterMs: number
  critical: boolean
  nextRun: bigint // hrtime for monotonic clock
  lastRun: number | null
  running: boolean
  consecutiveFailures: number
}

interface TaskState {
  id: string
  intervalMs: number
  nextRun: number
  lastRun: number | null
  running: boolean
  consecutiveFailures: number
  critical: boolean
}
```

## Temel Farklar

| Özellik         | Önceki Tasarım                     | Doğru Tasarım                               |
| --------------- | ---------------------------------- | ------------------------------------------- |
| Persistence     | File-based WAL + checkpoint        | None - clean slate on restart               |
| Circuit breaker | Evet, task'ı durdurur              | Yok - alert only, decision dışarıda         |
| Metrics         | Kendi track ediyor                 | Observable state, Watcher okur              |
| Recovery        | Missed execution detect + catch-up | No recovery - miss is acceptable            |
| Complexity      | ~400 LOC, file I/O                 | ~150 LOC, memory only                       |
| Decision making | Evet (circuit open/close)          | Hayır - fully observable, not authoritative |

## Neden Bu Yaklaşım Doğru?

**1. Security layer crash = security problem:**

- Scheduler state recover etmek yerine, neden crash olduğunu araştırmalısın
- Historical state tutmak corruption risk'i taşır
- Clean restart daha güvenli

**2. Decision-free prensibine uygun:**

- Task 3 kere fail etti → alert gönder, ama task'ı durdurma kararı alma
- External monitoring system (Watcher + DevOps) karar verir
- Circuit breaker = karar mekanizması → Tracehound'a ait değil

**3. Working Memory integration:**

```typescript
// Scheduler kendi state tutmaz, Working Memory'ye yazar
scheduler.onTaskFailure = (id, error, consecutive) => {
  workingMemory.set(
    `scheduler:${id}`,
    {
      consecutiveFailures: consecutive,
      lastError: error.message,
      timestamp: Date.now(),
    },
    { ttlMs: 300_000 }
  ) // 5 dakika

  // Watcher bunu okur ve alert kararı verir
}
```

**4. RFC-0000 uyumlu:**

- "Sync hot-path" → async complexity yok
- "GC-independent" → file I/O yok, hrtime kullan
- "Decision-free" → alert only, decision yok
- "Explicit lifecycle" → shutdown() çağrılır, implicit recovery yok
