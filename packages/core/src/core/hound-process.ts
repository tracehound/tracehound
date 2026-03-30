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

import { analyzePayload } from './hound-analysis.js'
import { createMessageParser, encodeHoundMessage, type HoundStatusMessage } from './hound-ipc.js'

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

const parser = createMessageParser()
let isProcessing = false

function currentTime(): number {
  // eslint-disable-next-line no-restricted-syntax -- child-process local bridge still respects fake timers in tests
  return Date.now()
}

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

function sendAnalysis(payload: ArrayBuffer): void {
  const analysis = analyzePayload(payload)
  const encoded = encodeHoundMessage({
    type: 'analysis',
    hash: analysis.hash,
    entropy: analysis.entropy,
    contentType: analysis.contentType,
    sizeBytes: analysis.sizeBytes,
  })
  process.stdout.write(encoded)
}

// ─────────────────────────────────────────────────────────────────────────────
// Processing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process evidence payload.
 *
 * @param payload - Evidence bytes
 */
async function processPayload(payload: ArrayBuffer): Promise<void> {
  if (isProcessing) {
    // Already processing - drop (single request at a time)
    return
  }

  isProcessing = true
  const startTime = currentTime()

  try {
    sendStatus('processing')
    sendAnalysis(payload)

    const processingTime = currentTime() - startTime
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
