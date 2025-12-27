/**
 * Hound Process Adapter - Platform-agnostic child process management.
 *
 * RFC-0000 REQUIREMENTS:
 * - OS-level memory isolation
 * - Independent crash domain
 * - SIGKILL on kill()
 * - No fork-specific semantics (spawn + pipe baseline)
 *
 * PLATFORM SUPPORT:
 *
 * | Feature              | Linux/macOS | Windows          |
 * |----------------------|-------------|------------------|
 * | Memory limit (V8)    | ✓ Enforced  | ✓ Enforced       |
 * | SIGKILL              | ✓ Native    | ✓ TerminateProcess |
 * | CPU limit            | ✗ N/A       | ✗ N/A            |
 * | Network isolation    | Declared    | Declared         |
 * | Filesystem isolation | Declared    | Declared         |
 *
 * WINDOWS LIMITATIONS:
 * - Process constraints (network, filesystem, child spawn) are DECLARATIVE ONLY
 * - No OS-level enforcement without external tools (Job Objects, containers)
 * - Production recommendation: Use WSL2 or Docker for full isolation
 *
 * SECURITY MODEL:
 * - Constraints are defense-in-depth, not security boundaries
 * - Core security relies on: process separation, SIGKILL, timeout
 * - Do NOT rely on constraint enforcement for security-critical isolation
 */

import { ChildProcess, spawn } from 'node:child_process'
import { createMessageParser, encodeMessage, type MessageParser } from './hound-ipc.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle to a spawned Hound process.
 */
export interface HoundHandle {
  /** OS process ID */
  readonly pid: number
  /** Internal process reference (not exposed) */
  readonly _process: ChildProcess
  /** Message parser for this process */
  readonly _parser: MessageParser
}

/**
 * Process exit callback.
 */
export type ExitCallback = (code: number | null, signal: string | null) => void

/**
 * Message callback.
 */
export type MessageCallback = (payload: ArrayBuffer) => void

/**
 * Process constraints (declarative, best-effort).
 *
 * NOTE: These are DECLARATIVE INTENT, not enforced guarantees.
 * Platform-dependent. No security correctness depends on enforcement.
 */
export interface HoundProcessConstraints {
  /** Max memory in MB (Linux: ulimit -v) */
  maxMemoryMB?: number
  /** Network access (declared, not enforced in JS) */
  networkAccess: false
  /** File system write (declared, not enforced in JS) */
  fileSystemWrite: false
  /** Child process spawn (declared, not enforced in JS) */
  childSpawn: false
}

/**
 * Default constraints (read-only).
 */
export const DEFAULT_CONSTRAINTS: Readonly<HoundProcessConstraints> = Object.freeze({
  maxMemoryMB: 128,
  networkAccess: false,
  fileSystemWrite: false,
  childSpawn: false,
})

/**
 * Hound Process Adapter interface.
 *
 * Abstracts child process management for:
 * - Current: Node.js child_process
 * - Future: WASM sandbox (same interface)
 */
export interface IHoundProcessAdapter {
  /**
   * Spawn a new Hound process.
   *
   * @param scriptPath - Path to Hound process script
   * @param constraints - Process constraints (declarative)
   * @returns Handle to spawned process
   */
  spawn(scriptPath: string, constraints?: Partial<HoundProcessConstraints>): HoundHandle

  /**
   * Send binary payload to process.
   *
   * @param handle - Process handle
   * @param payload - Binary payload
   */
  send(handle: HoundHandle, payload: ArrayBuffer): void

  /**
   * Kill process immediately (SIGKILL).
   *
   * @param handle - Process handle
   */
  kill(handle: HoundHandle): void

  /**
   * Register exit callback.
   *
   * @param handle - Process handle
   * @param callback - Exit callback
   */
  onExit(handle: HoundHandle, callback: ExitCallback): void

  /**
   * Register message callback.
   *
   * @param handle - Process handle
   * @param callback - Message callback
   */
  onMessage(handle: HoundHandle, callback: MessageCallback): void
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Hound Process Adapter.
 *
 * @returns Process adapter instance
 */
export function createProcessAdapter(): IHoundProcessAdapter {
  return {
    spawn(scriptPath: string, constraints?: Partial<HoundProcessConstraints>): HoundHandle {
      const mergedConstraints = { ...DEFAULT_CONSTRAINTS, ...constraints }

      // Build spawn options
      const execArgv: string[] = []

      // Memory limit (V8 heap)
      if (mergedConstraints.maxMemoryMB) {
        execArgv.push(`--max-old-space-size=${mergedConstraints.maxMemoryMB}`)
      }

      // Security flags
      execArgv.push('--disable-proto=throw')
      execArgv.push('--disallow-code-generation-from-strings')

      // Spawn child process
      // NOTE: Using spawn (not fork) for Windows compatibility
      const child = spawn(process.execPath, [...execArgv, scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false,
        windowsHide: true,
      })

      if (!child.pid) {
        throw new Error('Failed to spawn Hound process')
      }

      const parser = createMessageParser()

      return {
        pid: child.pid,
        _process: child,
        _parser: parser,
      }
    },

    send(handle: HoundHandle, payload: ArrayBuffer): void {
      const message = encodeMessage(payload)
      handle._process.stdin?.write(message)
    },

    kill(handle: HoundHandle): void {
      // SIGKILL for immediate termination
      handle._process.kill('SIGKILL')
    },

    onExit(handle: HoundHandle, callback: ExitCallback): void {
      handle._process.on('exit', (code, signal) => {
        callback(code, signal)
      })
    },

    onMessage(handle: HoundHandle, callback: MessageCallback): void {
      handle._process.stdout?.on('data', (chunk: Buffer) => {
        const messages = handle._parser.feed(chunk)
        for (const payload of messages) {
          callback(payload)
        }
      })
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock Adapter (for testing)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mock process state for testing.
 */
interface MockProcessState {
  pid: number
  alive: boolean
  exitCallbacks: ExitCallback[]
  messageCallbacks: MessageCallback[]
  receivedPayloads: ArrayBuffer[]
}

/**
 * Create a mock adapter for testing.
 * Does not spawn real processes.
 *
 * @returns Mock adapter with test utilities
 */
export function createMockAdapter(): IHoundProcessAdapter & {
  /** Get all mock processes */
  getMockProcesses(): Map<number, MockProcessState>
  /** Simulate process exit */
  simulateExit(pid: number, code: number | null): void
  /** Simulate message from process */
  simulateMessage(pid: number, payload: ArrayBuffer): void
} {
  const processes = new Map<number, MockProcessState>()
  let nextPid = 1000

  const mockAdapter: IHoundProcessAdapter & {
    getMockProcesses(): Map<number, MockProcessState>
    simulateExit(pid: number, code: number | null): void
    simulateMessage(pid: number, payload: ArrayBuffer): void
  } = {
    spawn(): HoundHandle {
      const pid = nextPid++
      const state: MockProcessState = {
        pid,
        alive: true,
        exitCallbacks: [],
        messageCallbacks: [],
        receivedPayloads: [],
      }
      processes.set(pid, state)

      return {
        pid,
        _process: { pid } as ChildProcess,
        _parser: createMessageParser(),
      }
    },

    send(handle: HoundHandle, payload: ArrayBuffer): void {
      const state = processes.get(handle.pid)
      if (state?.alive) {
        state.receivedPayloads.push(payload)
      }
    },

    kill(handle: HoundHandle): void {
      const state = processes.get(handle.pid)
      if (state?.alive) {
        state.alive = false
        for (const cb of state.exitCallbacks) {
          cb(null, 'SIGKILL')
        }
      }
    },

    onExit(handle: HoundHandle, callback: ExitCallback): void {
      const state = processes.get(handle.pid)
      state?.exitCallbacks.push(callback)
    },

    onMessage(handle: HoundHandle, callback: MessageCallback): void {
      const state = processes.get(handle.pid)
      state?.messageCallbacks.push(callback)
    },

    getMockProcesses(): Map<number, MockProcessState> {
      return processes
    },

    simulateExit(pid: number, code: number | null): void {
      const state = processes.get(pid)
      if (state?.alive) {
        state.alive = false
        for (const cb of state.exitCallbacks) {
          cb(code, null)
        }
      }
    },

    simulateMessage(pid: number, payload: ArrayBuffer): void {
      const state = processes.get(pid)
      if (state?.alive) {
        for (const cb of state.messageCallbacks) {
          cb(payload)
        }
      }
    },
  }

  return mockAdapter
}
