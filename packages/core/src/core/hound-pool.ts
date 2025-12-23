/**
 * Hound Pool - Process-based isolation pool for evidence processing.
 *
 * RFC-0000 CRITICAL INVARIANTS:
 * - activate() returns void, NOT Promise (Agent NEVER awaits)
 * - OS-level process isolation (child processes, not threads)
 * - Pre-spawned processes with jittered rotation
 * - Timeout + SIGKILL for stuck processes
 * - Binary IPC over stdio (no JSON)
 *
 * INVARIANT: activeProcesses <= totalProcesses
 * activeProcesses reflects OS-level active child processes
 */

import type { Evidence } from './evidence.js'
import { decodeHoundMessage } from './hound-ipc.js'
import {
  createMockAdapter,
  createProcessAdapter,
  DEFAULT_CONSTRAINTS,
  type HoundHandle,
  type HoundProcessConstraints,
  type IHoundProcessAdapter,
} from './process-adapter.js'

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
  /** Process ID that processed this */
  processId: string
  /** Error message if status is 'error' */
  error?: string
}

/**
 * Hound pool statistics (immutable snapshot).
 *
 * INVARIANT: activeProcesses <= totalProcesses
 */
export interface HoundPoolStats {
  /** Number of active processes (OS-level) */
  activeProcesses: number
  /** Total processes in pool */
  totalProcesses: number
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
 * Pool exhaustion action.
 */
export type PoolExhaustedAction = 'drop' | 'escalate' | 'defer'

/**
 * Hound pool configuration.
 */
export interface HoundPoolConfig {
  /** Number of pre-spawned processes */
  poolSize: number
  /** Timeout per process in ms */
  timeout: number
  /** Jitter range for rotation in ms */
  rotationJitterMs: number
  /** Action when pool exhausted (default: 'drop') */
  onPoolExhausted?: PoolExhaustedAction
  /** Max queue size for 'defer' action (default: 100) */
  deferQueueLimit?: number
  /** Process constraints (declarative, best-effort) */
  processConstraints?: Partial<HoundProcessConstraints>
  /** Path to hound process script */
  processScriptPath?: string
  /** Custom process adapter (for testing) */
  adapter?: IHoundProcessAdapter
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
   * Shutdown all processes.
   */
  shutdown(): void
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal process state.
 */
interface ProcessState {
  id: string
  pid: number | null
  handle: HoundHandle | null
  busy: boolean
  currentSignature: string | null
  startTime: number | null
  timeoutId: ReturnType<typeof setTimeout> | null
}

/**
 * Hound Pool implementation.
 *
 * Uses child process isolation per RFC-0000 amendment.
 */
export class HoundPool implements IHoundPool {
  private readonly processes: Map<string, ProcessState> = new Map()
  private readonly pendingQueue: Evidence[] = []
  private readonly resultHandlers: Array<(result: HoundResult) => void> = []
  private readonly processingTimes: number[] = []
  private readonly adapter: IHoundProcessAdapter
  private readonly processScriptPath: string
  private readonly onPoolExhausted: PoolExhaustedAction
  private readonly deferQueueLimit: number

  // Statistics
  private _totalActivations = 0
  private _totalTimeouts = 0
  private _totalErrors = 0

  constructor(private readonly config: HoundPoolConfig) {
    // Use provided adapter or create real one
    this.adapter = config.adapter ?? createProcessAdapter()
    this.processScriptPath = config.processScriptPath ?? './hound-process.js'
    this.onPoolExhausted = config.onPoolExhausted ?? 'drop'
    this.deferQueueLimit = config.deferQueueLimit ?? 100

    // Pre-spawn process slots (lazy spawn)
    for (let i = 0; i < config.poolSize; i++) {
      const state = this.createProcessState(`hound-${i}`)
      this.processes.set(state.id, state)
    }
  }

  /**
   * Process constraints (declarative, best-effort).
   */
  static readonly DEFAULT_CONSTRAINTS = DEFAULT_CONSTRAINTS

  activate(evidence: Evidence): void {
    this._totalActivations++

    // Find available process
    const processState = this.findAvailableProcess()

    if (processState) {
      this.assignToProcess(processState, evidence)
    } else {
      // Pool exhausted - apply configured action
      this.handlePoolExhausted(evidence)
    }
    // Returns immediately - no Promise
  }

  private handlePoolExhausted(evidence: Evidence): void {
    switch (this.onPoolExhausted) {
      case 'drop':
        // Silently drop - emit error result
        this.emitResult({
          signature: evidence.signature,
          status: 'error',
          durationMs: 0,
          processId: 'pool',
          error: 'pool_exhausted',
        })
        break

      case 'escalate':
        // Emit error and continue
        this._totalErrors++
        this.emitResult({
          signature: evidence.signature,
          status: 'error',
          durationMs: 0,
          processId: 'pool',
          error: 'pool_exhausted_escalated',
        })
        break

      case 'defer':
        // Queue for later (bounded)
        if (this.pendingQueue.length < this.deferQueueLimit) {
          this.pendingQueue.push(evidence)
        } else {
          // Queue full - drop
          this.emitResult({
            signature: evidence.signature,
            status: 'error',
            durationMs: 0,
            processId: 'pool',
            error: 'defer_queue_full',
          })
        }
        break
    }
  }

  terminate(signature: string): void {
    for (const [, processState] of this.processes) {
      if (processState.currentSignature === signature) {
        this.terminateProcess(processState, 'forced_terminate')
        return
      }
    }
  }

  get stats(): Readonly<HoundPoolStats> {
    let activeCount = 0
    for (const [, processState] of this.processes) {
      if (processState.busy) activeCount++
    }

    const avgProcessingMs =
      this.processingTimes.length > 0
        ? this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length
        : 0

    return Object.freeze({
      activeProcesses: activeCount,
      totalProcesses: this.processes.size,
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
    for (const [, processState] of this.processes) {
      if (processState.timeoutId) {
        clearTimeout(processState.timeoutId)
      }
      if (processState.handle) {
        this.adapter.kill(processState.handle)
      }
    }
    this.processes.clear()
    this.pendingQueue.length = 0
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  private createProcessState(id: string): ProcessState {
    return {
      id,
      pid: null,
      handle: null,
      busy: false,
      currentSignature: null,
      startTime: null,
      timeoutId: null,
    }
  }

  private findAvailableProcess(): ProcessState | null {
    for (const [, processState] of this.processes) {
      if (!processState.busy) {
        return processState
      }
    }
    return null
  }

  private assignToProcess(processState: ProcessState, evidence: Evidence): void {
    processState.busy = true
    processState.currentSignature = evidence.signature
    processState.startTime = Date.now()

    // Lazy spawn if needed
    if (!processState.handle) {
      try {
        processState.handle = this.adapter.spawn(
          this.processScriptPath,
          this.config.processConstraints
        )
        processState.pid = processState.handle.pid

        // Set up message handler
        this.adapter.onMessage(processState.handle, (payload) => {
          this.handleProcessMessage(processState, payload)
        })

        // Set up exit handler
        this.adapter.onExit(processState.handle, (code) => {
          this.handleProcessExit(processState, code)
        })
      } catch (err) {
        // Spawn failed
        this._totalErrors++
        this.emitResult({
          signature: evidence.signature,
          status: 'error',
          durationMs: 0,
          processId: processState.id,
          error: err instanceof Error ? err.message : 'spawn_failed',
        })
        processState.busy = false
        processState.currentSignature = null
        processState.startTime = null
        return
      }
    }

    // Set timeout
    processState.timeoutId = setTimeout(() => {
      this.handleTimeout(processState)
    }, this.config.timeout)

    // Send evidence to process
    this.adapter.send(processState.handle, evidence.bytes)
  }

  private handleProcessMessage(processState: ProcessState, payload: ArrayBuffer): void {
    try {
      const message = decodeHoundMessage(payload)

      if (message.type === 'status' && message.state === 'complete') {
        this.completeProcessing(processState, 'processed')
      } else if (message.type === 'status' && message.state === 'error') {
        this._totalErrors++
        this.terminateProcess(processState, 'error', message.error)
      }
      // Ignore 'processing' status - just acknowledgment
    } catch {
      // Decode error - terminate
      this._totalErrors++
      this.terminateProcess(processState, 'error', 'ipc_decode_error')
    }
  }

  private handleProcessExit(processState: ProcessState, code: number | null): void {
    if (processState.busy) {
      // Unexpected exit while busy
      this._totalErrors++
      this.terminateProcess(processState, 'error', `process_exit_${code}`)
    }
    // Reset handle - will respawn on next use
    processState.handle = null
    processState.pid = null
  }

  private handleTimeout(processState: ProcessState): void {
    this._totalTimeouts++
    this.terminateProcess(processState, 'timeout')
  }

  private terminateProcess(
    processState: ProcessState,
    reason: 'timeout' | 'forced_terminate' | 'error',
    errorMessage?: string
  ): void {
    const signature = processState.currentSignature
    const startTime = processState.startTime

    // Clear timeout
    if (processState.timeoutId) {
      clearTimeout(processState.timeoutId)
      processState.timeoutId = null
    }

    // Kill process if alive
    if (processState.handle) {
      this.adapter.kill(processState.handle)
      processState.handle = null
      processState.pid = null
    }

    // Reset state
    processState.busy = false
    processState.currentSignature = null
    processState.startTime = null

    // Emit result
    if (signature && startTime) {
      const durationMs = Date.now() - startTime

      const result: HoundResult = {
        signature,
        status: reason === 'timeout' ? 'timeout' : 'error',
        durationMs,
        processId: processState.id,
        error: errorMessage ?? reason,
      }

      this.emitResult(result)
    }

    // Process next in queue
    this.processNextInQueue()
  }

  private completeProcessing(processState: ProcessState, status: 'processed'): void {
    const signature = processState.currentSignature
    const startTime = processState.startTime

    // Clear timeout
    if (processState.timeoutId) {
      clearTimeout(processState.timeoutId)
      processState.timeoutId = null
    }

    // Reset state (keep handle alive for reuse)
    processState.busy = false
    processState.currentSignature = null
    processState.startTime = null

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
        processId: processState.id,
      }

      this.emitResult(result)
    }

    // Process next in queue
    this.processNextInQueue()
  }

  private processNextInQueue(): void {
    if (this.pendingQueue.length === 0) return

    const processState = this.findAvailableProcess()
    if (processState) {
      const evidence = this.pendingQueue.shift()!
      this.assignToProcess(processState, evidence)
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

// Re-export for testing
export { createMockAdapter }
