/**
 * Hound Process - Child process entry point.
 *
 * RFC-0000 REQUIREMENTS:
 * - Reads binary from stdin
 * - Writes status to stdout
 * - No dynamic require
 * - No config from parent
 * - Deterministic, single-purpose
 *
 * This script runs in an isolated child process.
 */

import { createMessageParser, encodeHoundMessage, type HoundStatusMessage } from './hound-ipc.js'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Processing simulation delay (will be replaced with real logic) */
const PROCESSING_DELAY_MS = 10

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

const parser = createMessageParser()
let isProcessing = false

// ─────────────────────────────────────────────────────────────────────────────
// Message Sending
// ─────────────────────────────────────────────────────────────────────────────

function sendStatus(state: 'processing' | 'complete' | 'error', errorMsg?: string): void {
  const message: HoundStatusMessage = { type: 'status', state }
  if (errorMsg) {
    message.error = errorMsg
  }
  const encoded = encodeHoundMessage(message)
  process.stdout.write(encoded)
}

function sendMetrics(processingTime: number): void {
  const memoryUsed = process.memoryUsage().heapUsed
  const encoded = encodeHoundMessage({ type: 'metrics', processingTime, memoryUsed })
  process.stdout.write(encoded)
}

// ─────────────────────────────────────────────────────────────────────────────
// Processing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process evidence payload.
 *
 * Current implementation: simulation.
 * Future: actual evidence analysis.
 *
 * @param payload - Evidence bytes
 */
async function processPayload(_payload: ArrayBuffer): Promise<void> {
  if (isProcessing) {
    // Already processing - drop (single request at a time)
    return
  }

  isProcessing = true
  const startTime = Date.now()

  try {
    sendStatus('processing')

    // Simulate processing
    // TODO: Replace with actual evidence analysis
    await new Promise((resolve) => setTimeout(resolve, PROCESSING_DELAY_MS))

    const processingTime = Date.now() - startTime
    sendMetrics(processingTime)
    sendStatus('complete')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    sendStatus('error', message)
  } finally {
    isProcessing = false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stdin Handler
// ─────────────────────────────────────────────────────────────────────────────

process.stdin.on('data', (chunk: Buffer) => {
  const messages = parser.feed(chunk)

  for (const payload of messages) {
    // Process each message
    processPayload(payload).catch((err) => {
      sendStatus('error', err instanceof Error ? err.message : 'Unknown error')
    })
  }
})

process.stdin.on('end', () => {
  // Parent closed stdin - exit gracefully
  process.exit(0)
})

process.stdin.on('error', (err) => {
  sendStatus('error', `stdin error: ${err.message}`)
  process.exit(1)
})

// ─────────────────────────────────────────────────────────────────────────────
// Uncaught Exception Handler
// ─────────────────────────────────────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  sendStatus('error', `uncaught: ${err.message}`)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason)
  sendStatus('error', `unhandled rejection: ${message}`)
  process.exit(1)
})

// ─────────────────────────────────────────────────────────────────────────────
// Ready Signal
// ─────────────────────────────────────────────────────────────────────────────

// Signal that process is ready
sendStatus('processing') // Initial "ready" state (processing = idle, waiting)
