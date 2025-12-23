/**
 * Hound IPC - Binary length-prefixed protocol for child process communication.
 *
 * RFC-0000 REQUIREMENTS:
 * - Length-prefixed binary over stdio
 * - JSON encoding is explicitly forbidden
 * - No retry semantics
 * - Fire-and-forget
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Message types that can be sent over IPC.
 * Matches RFC-0000 HoundMessage types.
 */
export type HoundMessageType = 'status' | 'metrics'

export type HoundStatus = 'processing' | 'complete' | 'error'

export interface HoundStatusMessage {
  type: 'status'
  state: HoundStatus
  error?: string
}

export interface HoundMetricsMessage {
  type: 'metrics'
  processingTime: number
  memoryUsed: number
}

export type HoundMessage = HoundStatusMessage | HoundMetricsMessage

/**
 * Parsed message from IPC stream.
 */
export interface ParsedMessage {
  payload: ArrayBuffer
  bytesConsumed: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Length prefix size in bytes (32-bit BE) */
const LENGTH_PREFIX_SIZE = 4

/** Maximum message size (1MB) */
const MAX_MESSAGE_SIZE = 1024 * 1024

// ─────────────────────────────────────────────────────────────────────────────
// Encoding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encode a payload with length prefix.
 *
 * Format: [4 bytes length BE][N bytes payload]
 *
 * @param payload - Raw payload bytes
 * @returns Length-prefixed buffer
 */
export function encodeMessage(payload: ArrayBuffer): Buffer {
  const payloadBuffer = Buffer.from(payload)
  const length = payloadBuffer.length

  if (length > MAX_MESSAGE_SIZE) {
    throw new Error(`Message too large: ${length} > ${MAX_MESSAGE_SIZE}`)
  }

  const result = Buffer.allocUnsafe(LENGTH_PREFIX_SIZE + length)

  // Write length as 32-bit BE
  result.writeUInt32BE(length, 0)

  // Copy payload
  payloadBuffer.copy(result, LENGTH_PREFIX_SIZE)

  return result
}

/**
 * Encode a HoundMessage to binary.
 *
 * @param message - Message to encode
 * @returns Length-prefixed buffer
 */
export function encodeHoundMessage(message: HoundMessage): Buffer {
  // Use minimal binary encoding (not JSON)
  // Format: [1 byte type][payload bytes]

  if (message.type === 'status') {
    // Type 0x01 = status
    // [1 byte type][1 byte state][optional error string]
    const stateCode = encodeStatusState(message.state)
    const errorBytes = message.error ? Buffer.from(message.error, 'utf8') : Buffer.alloc(0)

    const payload = Buffer.allocUnsafe(2 + errorBytes.length)
    payload[0] = 0x01 // type: status
    payload[1] = stateCode
    errorBytes.copy(payload, 2)

    return encodeMessage(
      payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.length)
    )
  } else {
    // Type 0x02 = metrics
    // [1 byte type][8 bytes processingTime][8 bytes memoryUsed]
    const payload = Buffer.allocUnsafe(17)
    payload[0] = 0x02 // type: metrics
    payload.writeDoubleBE(message.processingTime, 1)
    payload.writeDoubleBE(message.memoryUsed, 9)

    return encodeMessage(
      payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.length)
    )
  }
}

function encodeStatusState(state: HoundStatus): number {
  switch (state) {
    case 'processing':
      return 0x01
    case 'complete':
      return 0x02
    case 'error':
      return 0x03
    default:
      return 0x00
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Decoding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Try to parse a message from a buffer.
 * Handles partial buffers gracefully.
 *
 * @param buffer - Input buffer (may contain partial message)
 * @returns Parsed message or null if incomplete
 */
export function tryParseMessage(buffer: Buffer): ParsedMessage | null {
  // Need at least length prefix
  if (buffer.length < LENGTH_PREFIX_SIZE) {
    return null
  }

  const length = buffer.readUInt32BE(0)

  // Validate length
  if (length > MAX_MESSAGE_SIZE) {
    throw new Error(`Invalid message length: ${length}`)
  }

  const totalSize = LENGTH_PREFIX_SIZE + length

  // Check if we have full message
  if (buffer.length < totalSize) {
    return null
  }

  // Extract payload
  const payloadSlice = buffer.subarray(LENGTH_PREFIX_SIZE, totalSize)

  return {
    payload: new Uint8Array(payloadSlice).buffer,
    bytesConsumed: totalSize,
  }
}

/**
 * Decode a HoundMessage from binary payload.
 *
 * @param payload - Raw payload bytes (without length prefix)
 * @returns Decoded message
 */
export function decodeHoundMessage(payload: ArrayBuffer): HoundMessage {
  const buffer = Buffer.from(payload)

  if (buffer.length < 1) {
    throw new Error('Empty message payload')
  }

  const type = buffer[0]

  if (type === 0x01) {
    // Status message
    if (buffer.length < 2) {
      throw new Error('Invalid status message: too short')
    }

    const stateCode = buffer[1] ?? 0
    const state = decodeStatusState(stateCode)
    const errorStr = buffer.length > 2 ? buffer.subarray(2).toString('utf8') : undefined

    const result: HoundStatusMessage = { type: 'status', state }
    if (errorStr) {
      result.error = errorStr
    }
    return result
  } else if (type === 0x02) {
    // Metrics message
    if (buffer.length < 17) {
      throw new Error('Invalid metrics message: too short')
    }

    const processingTime = buffer.readDoubleBE(1)
    const memoryUsed = buffer.readDoubleBE(9)

    return { type: 'metrics', processingTime, memoryUsed }
  } else {
    throw new Error(`Unknown message type: ${type}`)
  }
}

function decodeStatusState(code: number): HoundStatus {
  switch (code) {
    case 0x01:
      return 'processing'
    case 0x02:
      return 'complete'
    case 0x03:
      return 'error'
    default:
      throw new Error(`Unknown status state: ${code}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Message Parser (handles streaming)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Streaming message parser.
 * Handles partial buffers and backpressure.
 */
export interface MessageParser {
  /**
   * Feed data into parser.
   * @param chunk - New data chunk
   * @returns Array of complete messages
   */
  feed(chunk: Buffer): ArrayBuffer[]

  /**
   * Get remaining buffered bytes.
   */
  readonly bufferedBytes: number

  /**
   * Reset parser state.
   */
  reset(): void
}

/**
 * Create a streaming message parser.
 *
 * @returns Message parser instance
 */
export function createMessageParser(): MessageParser {
  let buffer = Buffer.alloc(0)

  return {
    feed(chunk: Buffer): ArrayBuffer[] {
      // Append chunk to buffer
      buffer = Buffer.concat([buffer, chunk])

      const messages: ArrayBuffer[] = []

      // Parse all complete messages
      while (true) {
        const result = tryParseMessage(buffer)
        if (!result) break

        messages.push(result.payload)
        buffer = buffer.subarray(result.bytesConsumed)
      }

      return messages
    },

    get bufferedBytes(): number {
      return buffer.length
    },

    reset(): void {
      buffer = Buffer.alloc(0)
    },
  }
}
