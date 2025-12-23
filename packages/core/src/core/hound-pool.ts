/**
 * Hound Pool - sandboxed worker pool for evidence processing.
 *
 * RFC-0000 CRITICAL INVARIANTS:
 * - activate() returns void, NOT Promise (Agent NEVER awaits)
 * - Strict sandbox only (no permissive mode)
 * - Pre-spawned workers with jittered rotation
 * - Timeout + force-terminate for stuck workers
 */

import type { Evidence } from './evidence.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hound execution result.
 * Delivered via internal queue, NOT via Promise to Agent.
 */
export interface HoundResult {
  /** Evidence signature */
  signature: string
  /** Execution status */
  status: 'processed' | 'timeout' | 'error'
  /** Processing duration in ms */
  durationMs: number
  /** Worker ID that processed this */
  workerId: string
  /** Error message if status is 'error' */
  error?: string
}

/**
 * Hound pool statistics (immutable snapshot).
 */
export interface HoundPoolStats {
  /** Number of active workers */
  activeWorkers: number
  /** Total workers in pool */
  totalWorkers: number
  /** Total activations */
  totalActivations: number
  /** Total timeouts */
  totalTimeouts: number
  /** Total errors */
  totalErrors: number
  /** Average processing time in ms */
  avgProcessingMs: number
}

/**
 * Sandbox configuration.
 * RFC: No permissive mode. All constraints are mandatory.
 */
export interface SandboxConstraints {
  /** Deny eval/Function constructor */
  readonly eval: false
  /** Deny network access */
  readonly network: false
  /** Deny storage access */
  readonly storage: false
  /** Deny importScripts */
  readonly importScripts: false
}

/**
 * Hound pool configuration.
 */
export interface HoundPoolConfig {
  /** Number of pre-spawned workers */
  poolSize: number
  /** Timeout per worker in ms */
  timeout: number
  /** Jitter range for rotation in ms */
  rotationJitterMs: number
}

/**
 * Hound pool interface.
 *
 * CRITICAL: activate() returns void.
 * Agent NEVER awaits Hound Pool.
 */
export interface IHoundPool {
  /**
   * Activate hound for evidence processing.
   * Returns immediately. Result via onResult callback.
   *
   * @param evidence - Evidence to process
   */
  activate(evidence: Evidence): void

  /**
   * Force terminate specific hound by signature.
   *
   * @param signature - Evidence signature to terminate
   */
  terminate(signature: string): void

  /**
   * Get pool statistics (immutable snapshot).
   */
  readonly stats: Readonly<HoundPoolStats>

  /**
   * Register result handler.
   * Internal use only - NOT exposed to Agent.
   */
  onResult(handler: (result: HoundResult) => void): void

  /**
   * Shutdown all workers.
   */
  shutdown(): void
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal worker state.
 */
interface WorkerState {
  id: string
  busy: boolean
  currentSignature: string | null
  startTime: number | null
  timeoutId: ReturnType<typeof setTimeout> | null
}

/**
 * Hound Pool implementation.
 *
 * Phase 4 implementation uses simulated workers (no real Worker threads).
 * Real worker isolation will be added in Phase 5.
 */
export class HoundPool implements IHoundPool {
  private readonly workers: Map<string, WorkerState> = new Map()
  private readonly pendingQueue: Evidence[] = []
  private readonly resultHandlers: Array<(result: HoundResult) => void> = []
  private readonly processingTimes: number[] = []

  // Statistics
  private _totalActivations = 0
  private _totalTimeouts = 0
  private _totalErrors = 0

  constructor(private readonly config: HoundPoolConfig) {
    // Pre-spawn workers
    for (let i = 0; i < config.poolSize; i++) {
      const worker = this.createWorker(`hound-${i}`)
      this.workers.set(worker.id, worker)
    }
  }

  /**
   * Sandbox constraints (read-only, no permissive mode).
   */
  static readonly SANDBOX_CONSTRAINTS: SandboxConstraints = Object.freeze({
    eval: false,
    network: false,
    storage: false,
    importScripts: false,
  })

  activate(evidence: Evidence): void {
    this._totalActivations++

    // Find available worker
    const worker = this.findAvailableWorker()

    if (worker) {
      this.assignToWorker(worker, evidence)
    } else {
      // Queue for later processing
      this.pendingQueue.push(evidence)
    }
    // Returns immediately - no Promise
  }

  terminate(signature: string): void {
    for (const [, worker] of this.workers) {
      if (worker.currentSignature === signature) {
        this.terminateWorker(worker, 'forced_terminate')
        return
      }
    }
  }

  get stats(): Readonly<HoundPoolStats> {
    let activeCount = 0
    for (const [, worker] of this.workers) {
      if (worker.busy) activeCount++
    }

    const avgProcessingMs =
      this.processingTimes.length > 0
        ? this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length
        : 0

    return Object.freeze({
      activeWorkers: activeCount,
      totalWorkers: this.workers.size,
      totalActivations: this._totalActivations,
      totalTimeouts: this._totalTimeouts,
      totalErrors: this._totalErrors,
      avgProcessingMs,
    })
  }

  onResult(handler: (result: HoundResult) => void): void {
    this.resultHandlers.push(handler)
  }

  shutdown(): void {
    for (const [, worker] of this.workers) {
      if (worker.timeoutId) {
        clearTimeout(worker.timeoutId)
      }
    }
    this.workers.clear()
    this.pendingQueue.length = 0
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  private createWorker(id: string): WorkerState {
    return {
      id,
      busy: false,
      currentSignature: null,
      startTime: null,
      timeoutId: null,
    }
  }

  private findAvailableWorker(): WorkerState | null {
    for (const [, worker] of this.workers) {
      if (!worker.busy) {
        return worker
      }
    }
    return null
  }

  private assignToWorker(worker: WorkerState, evidence: Evidence): void {
    worker.busy = true
    worker.currentSignature = evidence.signature
    worker.startTime = Date.now()

    // Set timeout
    worker.timeoutId = setTimeout(() => {
      this.handleTimeout(worker)
    }, this.config.timeout)

    // Simulate async processing (Phase 4: no real worker)
    // In Phase 5, this will dispatch to actual Worker thread
    this.simulateProcessing(worker, evidence)
  }

  private simulateProcessing(worker: WorkerState, evidence: Evidence): void {
    // Simulate processing delay (10-50ms)
    const jitter = Math.random() * this.config.rotationJitterMs
    const delay = 10 + jitter

    setTimeout(() => {
      if (!worker.busy || worker.currentSignature !== evidence.signature) {
        // Already terminated or reassigned
        return
      }

      this.completeProcessing(worker, 'processed')
    }, delay)
  }

  private handleTimeout(worker: WorkerState): void {
    this._totalTimeouts++
    this.terminateWorker(worker, 'timeout')
  }

  private terminateWorker(
    worker: WorkerState,
    reason: 'timeout' | 'forced_terminate' | 'error'
  ): void {
    const signature = worker.currentSignature
    const startTime = worker.startTime

    // Clear timeout
    if (worker.timeoutId) {
      clearTimeout(worker.timeoutId)
      worker.timeoutId = null
    }

    // Reset worker state
    worker.busy = false
    worker.currentSignature = null
    worker.startTime = null

    // Emit result
    if (signature && startTime) {
      const durationMs = Date.now() - startTime

      const result: HoundResult = {
        signature,
        status: reason === 'timeout' ? 'timeout' : 'error',
        durationMs,
        workerId: worker.id,
        error: reason,
      }

      this.emitResult(result)
    }

    // Process next in queue
    this.processNextInQueue()
  }

  private completeProcessing(worker: WorkerState, status: 'processed'): void {
    const signature = worker.currentSignature
    const startTime = worker.startTime

    // Clear timeout
    if (worker.timeoutId) {
      clearTimeout(worker.timeoutId)
      worker.timeoutId = null
    }

    // Reset worker state
    worker.busy = false
    worker.currentSignature = null
    worker.startTime = null

    // Emit result
    if (signature && startTime) {
      const durationMs = Date.now() - startTime
      this.processingTimes.push(durationMs)

      // Keep only last 100 times for avg calculation
      if (this.processingTimes.length > 100) {
        this.processingTimes.shift()
      }

      const result: HoundResult = {
        signature,
        status,
        durationMs,
        workerId: worker.id,
      }

      this.emitResult(result)
    }

    // Process next in queue
    this.processNextInQueue()
  }

  private processNextInQueue(): void {
    if (this.pendingQueue.length === 0) return

    const worker = this.findAvailableWorker()
    if (worker) {
      const evidence = this.pendingQueue.shift()!
      this.assignToWorker(worker, evidence)
    }
  }

  private emitResult(result: HoundResult): void {
    for (const handler of this.resultHandlers) {
      try {
        handler(result)
      } catch {
        this._totalErrors++
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Hound Pool instance.
 *
 * @param config - Pool configuration
 */
export function createHoundPool(config: HoundPoolConfig): IHoundPool {
  return new HoundPool(config)
}
