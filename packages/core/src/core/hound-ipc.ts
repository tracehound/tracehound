/**
 * Hound IPC - Binary length-prefixed protocol for child process communication.
 *
 * RFC-0000 REQUIREMENTS:
 * - Length-prefixed binary over stdio
 * - JSON encoding is explicitly forbidden
 * - No retry semantics
 * - Fire-and-forget
 */

import { Errors } from '../types/errors.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Message types that can be sent over IPC.
 * Matches RFC-0000 HoundMessage types.
 */
export type HoundMessageType = 'status' | 'metrics' | 'analysis'

export type HoundStatus = 'processing' | 'complete' | 'error'

export type HoundContentType =
  | 'unknown'
  | 'text'
  | 'json'
  | 'binary'
  | 'gzip'
  | 'zip'
  | 'pdf'
  | 'png'
  | 'jpeg'
  | 'gif'

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

export interface HoundAnalysisMessage {
  type: 'analysis'
  hash: string
  entropy: number
  contentType: HoundContentType
  sizeBytes: number
}

export type HoundMessage = HoundStatusMessage | HoundMetricsMessage | HoundAnalysisMessage

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
    throw Errors.processIpcMessageTooLarge(length, MAX_MESSAGE_SIZE)
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
      payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.length),
    )
  }

  if (message.type === 'metrics') {
    // Type 0x02 = metrics
    // [1 byte type][8 bytes processingTime][8 bytes memoryUsed]
    const payload = Buffer.allocUnsafe(17)
    payload[0] = 0x02 // type: metrics
    payload.writeDoubleBE(message.processingTime, 1)
    payload.writeDoubleBE(message.memoryUsed, 9)

    return encodeMessage(
      payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.length),
    )
  }

  // Type 0x03 = analysis
  // [1 byte type][2 bytes hashLen][hash utf8][8 bytes entropy][1 byte contentType][4 bytes sizeBytes]
  const hashBytes = Buffer.from(message.hash, 'utf8')
  if (hashBytes.length > 0xffff) {
    throw Errors.processIpcInvalidAnalysisMessage()
  }

  const payload = Buffer.allocUnsafe(1 + 2 + hashBytes.length + 8 + 1 + 4)
  payload[0] = 0x03
  payload.writeUInt16BE(hashBytes.length, 1)
  hashBytes.copy(payload, 3)

  let offset = 3 + hashBytes.length
  payload.writeDoubleBE(message.entropy, offset)
  offset += 8
  payload[offset] = encodeContentType(message.contentType)
  offset += 1
  payload.writeUInt32BE(message.sizeBytes, offset)

  return encodeMessage(payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.length))
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

function encodeContentType(contentType: HoundContentType): number {
  switch (contentType) {
    case 'unknown':
      return 0x00
    case 'text':
      return 0x01
    case 'json':
      return 0x02
    case 'binary':
      return 0x03
    case 'gzip':
      return 0x04
    case 'zip':
      return 0x05
    case 'pdf':
      return 0x06
    case 'png':
      return 0x07
    case 'jpeg':
      return 0x08
    case 'gif':
      return 0x09
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
    throw Errors.processIpcInvalidLength(length)
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
    throw Errors.processIpcEmptyPayload()
  }

  const type = buffer[0] ?? 0

  if (type === 0x01) {
    // Status message
    if (buffer.length < 2) {
      throw Errors.processIpcInvalidStatusMessage()
    }

    const stateCode = buffer[1] ?? 0
    const state = decodeStatusState(stateCode)
    const errorStr = buffer.length > 2 ? buffer.subarray(2).toString('utf8') : undefined

    const result: HoundStatusMessage = { type: 'status', state }
    if (errorStr) {
      result.error = errorStr
    }
    return result
  }

  if (type === 0x02) {
    // Metrics message
    if (buffer.length < 17) {
      throw Errors.processIpcInvalidMetricsMessage()
    }

    const processingTime = buffer.readDoubleBE(1)
    const memoryUsed = buffer.readDoubleBE(9)

    return { type: 'metrics', processingTime, memoryUsed }
  }

  if (type === 0x03) {
    if (buffer.length < 16) {
      throw Errors.processIpcInvalidAnalysisMessage()
    }

    const hashLen = buffer.readUInt16BE(1)
    const hashStart = 3
    const hashEnd = hashStart + hashLen
    const entropyStart = hashEnd
    const entropyEnd = entropyStart + 8
    const contentTypeIndex = entropyEnd
    const sizeStart = contentTypeIndex + 1
    const sizeEnd = sizeStart + 4

    if (buffer.length < sizeEnd) {
      throw Errors.processIpcInvalidAnalysisMessage()
    }

    const hash = buffer.subarray(hashStart, hashEnd).toString('utf8')
    const entropy = buffer.readDoubleBE(entropyStart)
    const contentType = decodeContentType(buffer[contentTypeIndex] ?? 0)
    const sizeBytes = buffer.readUInt32BE(sizeStart)

    return { type: 'analysis', hash, entropy, contentType, sizeBytes }
  }

  throw Errors.processIpcUnknownMessageType(type)
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
      throw Errors.processIpcUnknownStatusState(code)
  }
}

function decodeContentType(code: number): HoundContentType {
  switch (code) {
    case 0x00:
      return 'unknown'
    case 0x01:
      return 'text'
    case 0x02:
      return 'json'
    case 0x03:
      return 'binary'
    case 0x04:
      return 'gzip'
    case 0x05:
      return 'zip'
    case 0x06:
      return 'pdf'
    case 0x07:
      return 'png'
    case 0x08:
      return 'jpeg'
    case 0x09:
      return 'gif'
    default:
      throw Errors.processIpcUnknownContentType(code)
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
      try {
        while (true) {
          const result = tryParseMessage(buffer)
          if (!result) break

          messages.push(result.payload)
          buffer = buffer.subarray(result.bytesConsumed)
        }
      } catch (error: unknown) {
        // Safety invariant: malformed frames MUST NOT keep parser
        // in a corrupted/amplifying buffered state.
        buffer = Buffer.alloc(0)
        throw error
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
