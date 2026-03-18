/**
 * Hound IPC tests - Binary protocol encoding/decoding.
 */

import { describe, expect, it } from 'vitest'
import {
  createMessageParser,
  decodeHoundMessage,
  encodeHoundMessage,
  encodeMessage,
  tryParseMessage,
  type HoundMessage,
} from '../src/core/hound-ipc.js'

describe('HoundIPC', () => {
  describe('encodeMessage', () => {
    it('should encode payload with length prefix', () => {
      const payload = Buffer.from('test')
      const encoded = encodeMessage(
        payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
      )

      // First 4 bytes = length (BE)
      const length = encoded.readUInt32BE(0)
      expect(length).toBe(4)

      // Remaining bytes = payload
      const payloadPart = encoded.subarray(4)
      expect(payloadPart.toString()).toBe('test')
    })

    it('should throw on oversized message', () => {
      const oversized = Buffer.alloc(2 * 1024 * 1024) // 2MB > 1MB limit
      expect(() => encodeMessage(oversized.buffer as ArrayBuffer)).toThrow('Message too large')
    })

    it('should handle empty payload', () => {
      const empty = Buffer.alloc(0)
      const encoded = encodeMessage(
        empty.buffer.slice(empty.byteOffset, empty.byteOffset + empty.byteLength),
      )

      const length = encoded.readUInt32BE(0)
      expect(length).toBe(0)
      expect(encoded.length).toBe(4) // Only length prefix
    })
  })

  describe('encodeHoundMessage', () => {
    it('should encode status:processing message', () => {
      const message: HoundMessage = { type: 'status', state: 'processing' }
      const encoded = encodeHoundMessage(message)

      // Should have length prefix + type + state
      expect(encoded.length).toBeGreaterThan(4)

      // Decode to verify
      const length = encoded.readUInt32BE(0)
      const payload = encoded.subarray(4, 4 + length)

      expect(payload[0]).toBe(0x01) // type: status
      expect(payload[1]).toBe(0x01) // state: processing
    })

    it('should encode status:complete message', () => {
      const message: HoundMessage = { type: 'status', state: 'complete' }
      const encoded = encodeHoundMessage(message)

      const length = encoded.readUInt32BE(0)
      const payload = encoded.subarray(4, 4 + length)

      expect(payload[0]).toBe(0x01) // type: status
      expect(payload[1]).toBe(0x02) // state: complete
    })

    it('should encode status:error with error message', () => {
      const message: HoundMessage = { type: 'status', state: 'error', error: 'test_error' }
      const encoded = encodeHoundMessage(message)

      const length = encoded.readUInt32BE(0)
      const payload = encoded.subarray(4, 4 + length)

      expect(payload[0]).toBe(0x01) // type: status
      expect(payload[1]).toBe(0x03) // state: error
      expect(payload.subarray(2).toString('utf8')).toBe('test_error')
    })

    it('should throw when status state is invalid at runtime', () => {
      const invalid = {
        type: 'status',
        state: 'invalid',
      } as unknown as HoundMessage

      expect(() => encodeHoundMessage(invalid)).toThrow(/status/i)
    })

    it('should throw when message type is unknown at runtime', () => {
      const invalid = {
        type: 'unknown',
      } as unknown as HoundMessage

      expect(() => encodeHoundMessage(invalid)).toThrow(/analysis/i)
    })

    it('should encode metrics message', () => {
      const message: HoundMessage = { type: 'metrics', processingTime: 123.45, memoryUsed: 678.9 }
      const encoded = encodeHoundMessage(message)

      const length = encoded.readUInt32BE(0)
      const payload = encoded.subarray(4, 4 + length)

      expect(payload[0]).toBe(0x02) // type: metrics
      expect(payload.length).toBe(17) // 1 + 8 + 8
    })

    it('should encode analysis message', () => {
      const message: HoundMessage = {
        type: 'analysis',
        hash: 'abc123',
        entropy: 7.42,
        contentType: 'json',
        sizeBytes: 256,
      }
      const encoded = encodeHoundMessage(message)
      const length = encoded.readUInt32BE(0)
      const payload = encoded.subarray(4, 4 + length)

      expect(payload[0]).toBe(0x03) // type: analysis
      expect(payload.length).toBeGreaterThan(16)
    })

    it('should encode/decode all analysis content types', () => {
      const contentTypes = ['unknown', 'gzip', 'zip', 'pdf', 'png', 'jpeg', 'gif'] as const

      for (const contentType of contentTypes) {
        const encoded = encodeHoundMessage({
          type: 'analysis',
          hash: 'abc',
          entropy: 1.23,
          contentType,
          sizeBytes: 12,
        })
        const length = encoded.readUInt32BE(0)
        const payload = encoded.subarray(4, 4 + length)
        const decoded = decodeHoundMessage(new Uint8Array(payload).buffer)

        expect(decoded.type).toBe('analysis')
        if (decoded.type === 'analysis') {
          expect(decoded.contentType).toBe(contentType)
        }
      }
    })

    it('should throw when analysis contentType is invalid at runtime', () => {
      const invalid = {
        type: 'analysis',
        hash: 'abc',
        entropy: 1.23,
        contentType: 'exe',
        sizeBytes: 12,
      } as unknown as HoundMessage

      expect(() => encodeHoundMessage(invalid)).toThrow(/analysis/i)
    })

    it('should throw when analysis payload is structurally invalid at runtime', () => {
      const invalid = {
        type: 'analysis',
        hash: undefined,
        entropy: Number.NaN,
        contentType: 'json',
        sizeBytes: -1,
      } as unknown as HoundMessage

      expect(() => encodeHoundMessage(invalid)).toThrow(/analysis/i)
    })

    it('should throw when analysis hash length exceeds uint16', () => {
      const oversizedHash = 'a'.repeat(70_000)
      expect(() =>
        encodeHoundMessage({
          type: 'analysis',
          hash: oversizedHash,
          entropy: 1,
          contentType: 'binary',
          sizeBytes: 1,
        }),
      ).toThrow(/analysis/i)
    })
  })

  describe('tryParseMessage', () => {
    it('should return null for incomplete message', () => {
      const partial = Buffer.from([0x00, 0x00]) // Only 2 bytes, need 4 for length
      const result = tryParseMessage(partial)

      expect(result).toBeNull()
    })

    it('should return null when payload is incomplete', () => {
      const buffer = Buffer.alloc(10)
      buffer.writeUInt32BE(20, 0) // Says 20 bytes, but only 6 available

      const result = tryParseMessage(buffer)
      expect(result).toBeNull()
    })

    it('should parse complete message', () => {
      const payload = Buffer.from('hello')
      const encoded = encodeMessage(
        payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
      )

      const result = tryParseMessage(encoded)

      expect(result).not.toBeNull()
      expect(result!.bytesConsumed).toBe(4 + 5) // length prefix + payload
      expect(Buffer.from(result!.payload).toString()).toBe('hello')
    })

    it('should throw on invalid length', () => {
      const buffer = Buffer.alloc(4)
      buffer.writeUInt32BE(2 * 1024 * 1024, 0) // 2MB > max

      expect(() => tryParseMessage(buffer)).toThrow('Message too large')
    })
  })

  describe('decodeHoundMessage', () => {
    it('should decode status:processing message', () => {
      const encoded = encodeHoundMessage({ type: 'status', state: 'processing' })
      const length = encoded.readUInt32BE(0)
      const payload = encoded.subarray(4, 4 + length)

      const decoded = decodeHoundMessage(new Uint8Array(payload).buffer)

      expect(decoded.type).toBe('status')
      if (decoded.type === 'status') {
        expect(decoded.state).toBe('processing')
      }
    })

    it('should decode status:complete message', () => {
      const encoded = encodeHoundMessage({ type: 'status', state: 'complete' })
      const length = encoded.readUInt32BE(0)
      const payload = encoded.subarray(4, 4 + length)

      const decoded = decodeHoundMessage(new Uint8Array(payload).buffer)

      expect(decoded.type).toBe('status')
      if (decoded.type === 'status') {
        expect(decoded.state).toBe('complete')
      }
    })

    it('should decode status:error with error message', () => {
      const encoded = encodeHoundMessage({
        type: 'status',
        state: 'error',
        error: 'analysis_failed',
      })
      const length = encoded.readUInt32BE(0)
      const payload = encoded.subarray(4, 4 + length)

      const decoded = decodeHoundMessage(new Uint8Array(payload).buffer)

      expect(decoded.type).toBe('status')
      if (decoded.type === 'status') {
        expect(decoded.state).toBe('error')
        expect(decoded.error).toBe('analysis_failed')
      }
    })

    it('should decode metrics message', () => {
      const encoded = encodeHoundMessage({
        type: 'metrics',
        processingTime: 42.5,
        memoryUsed: 1024,
      })
      const length = encoded.readUInt32BE(0)
      const payload = encoded.subarray(4, 4 + length)

      const decoded = decodeHoundMessage(new Uint8Array(payload).buffer)

      expect(decoded.type).toBe('metrics')
      if (decoded.type === 'metrics') {
        expect(decoded.processingTime).toBeCloseTo(42.5)
        expect(decoded.memoryUsed).toBeCloseTo(1024)
      }
    })

    it('should decode analysis message', () => {
      const encoded = encodeHoundMessage({
        type: 'analysis',
        hash: 'ff00aa',
        entropy: 5.5,
        contentType: 'text',
        sizeBytes: 77,
      })
      const length = encoded.readUInt32BE(0)
      const payload = encoded.subarray(4, 4 + length)

      const decoded = decodeHoundMessage(new Uint8Array(payload).buffer)

      expect(decoded.type).toBe('analysis')
      if (decoded.type === 'analysis') {
        expect(decoded.hash).toBe('ff00aa')
        expect(decoded.entropy).toBeCloseTo(5.5)
        expect(decoded.contentType).toBe('text')
        expect(decoded.sizeBytes).toBe(77)
      }
    })

    it('should throw on empty payload', () => {
      const empty = Buffer.alloc(0)
      expect(() => decodeHoundMessage(empty.buffer as ArrayBuffer)).toThrow(/Empty/)
    })

    it('should throw on unknown message type', () => {
      const invalid = Buffer.from([0xff, 0x00]) // Invalid type 0xff
      expect(() => decodeHoundMessage(invalid.buffer as ArrayBuffer)).toThrow(/Unknown/)
    })

    it('should throw on truncated status message', () => {
      const truncated = Buffer.from([0x01]) // Type only, no state
      const arrayBuffer = truncated.buffer.slice(
        truncated.byteOffset,
        truncated.byteOffset + truncated.byteLength,
      )
      expect(() => decodeHoundMessage(arrayBuffer)).toThrow(/Invalid.*status/)
    })

    it('should throw on truncated metrics message', () => {
      const truncated = Buffer.from([0x02, 0x00, 0x00]) // Type + partial data
      const arrayBuffer = truncated.buffer.slice(
        truncated.byteOffset,
        truncated.byteOffset + truncated.byteLength,
      )
      expect(() => decodeHoundMessage(arrayBuffer)).toThrow(/Invalid.*metrics/)
    })

    it('should throw on unknown status state code', () => {
      const payload = Buffer.from([0x01, 0x00]) // status with invalid state code
      const arrayBuffer = payload.buffer.slice(
        payload.byteOffset,
        payload.byteOffset + payload.byteLength,
      )
      expect(() => decodeHoundMessage(arrayBuffer)).toThrow(/Unknown.*status/i)
    })

    it('should throw on unknown analysis content type code', () => {
      const hash = Buffer.from('h', 'utf8')
      const payload = Buffer.alloc(1 + 2 + hash.length + 8 + 1 + 4)
      payload[0] = 0x03
      payload.writeUInt16BE(hash.length, 1)
      hash.copy(payload, 3)
      let offset = 3 + hash.length
      payload.writeDoubleBE(1.5, offset)
      offset += 8
      payload[offset] = 0x7f // invalid content type
      offset += 1
      payload.writeUInt32BE(10, offset)

      const arrayBuffer = payload.buffer.slice(
        payload.byteOffset,
        payload.byteOffset + payload.byteLength,
      )
      expect(() => decodeHoundMessage(arrayBuffer)).toThrow(/Unknown.*content/i)
    })

    it('should reject analysis message with empty hash', () => {
      const payload = Buffer.alloc(1 + 2 + 0 + 8 + 1 + 4)
      payload[0] = 0x03
      payload.writeUInt16BE(0, 1)
      let offset = 3
      payload.writeDoubleBE(1.23, offset)
      offset += 8
      payload[offset] = 0x02 // json
      offset += 1
      payload.writeUInt32BE(10, offset)

      const arrayBuffer = payload.buffer.slice(
        payload.byteOffset,
        payload.byteOffset + payload.byteLength,
      )
      expect(() => decodeHoundMessage(arrayBuffer)).toThrow(/Invalid.*analysis/i)
    })

    it('should reject analysis message with non-finite entropy', () => {
      const hash = Buffer.from('hash', 'utf8')
      const payload = Buffer.alloc(1 + 2 + hash.length + 8 + 1 + 4)
      payload[0] = 0x03
      payload.writeUInt16BE(hash.length, 1)
      hash.copy(payload, 3)
      let offset = 3 + hash.length
      payload.writeDoubleBE(Number.NaN, offset)
      offset += 8
      payload[offset] = 0x01 // text
      offset += 1
      payload.writeUInt32BE(10, offset)

      const arrayBuffer = payload.buffer.slice(
        payload.byteOffset,
        payload.byteOffset + payload.byteLength,
      )
      expect(() => decodeHoundMessage(arrayBuffer)).toThrow(/Invalid.*analysis/i)
    })
  })

  describe('createMessageParser', () => {
    it('should parse single complete message', () => {
      const parser = createMessageParser()
      const encoded = encodeHoundMessage({ type: 'status', state: 'complete' })

      const messages = parser.feed(encoded)

      expect(messages.length).toBe(1)
      const decoded = decodeHoundMessage(messages[0]!)
      expect(decoded.type).toBe('status')
      if (decoded.type === 'status') {
        expect(decoded.state).toBe('complete')
      }
    })

    it('should handle partial messages across chunks', () => {
      const parser = createMessageParser()
      const encoded = encodeHoundMessage({ type: 'status', state: 'processing' })

      // Split into two chunks
      const chunk1 = encoded.subarray(0, 5)
      const chunk2 = encoded.subarray(5)

      const messages1 = parser.feed(chunk1)
      expect(messages1.length).toBe(0) // Incomplete

      const messages2 = parser.feed(chunk2)
      expect(messages2.length).toBe(1) // Now complete
    })

    it('should parse multiple messages in single chunk', () => {
      const parser = createMessageParser()
      const msg1 = encodeHoundMessage({ type: 'status', state: 'processing' })
      const msg2 = encodeHoundMessage({ type: 'status', state: 'complete' })
      const combined = Buffer.concat([msg1, msg2])

      const messages = parser.feed(combined)

      expect(messages.length).toBe(2)
    })

    it('should track buffered bytes', () => {
      const parser = createMessageParser()
      const encoded = encodeHoundMessage({ type: 'status', state: 'complete' })
      const partial = encoded.subarray(0, 5)

      parser.feed(partial)
      expect(parser.bufferedBytes).toBe(5)
    })

    it('should reset parser state', () => {
      const parser = createMessageParser()
      const partial = Buffer.from([0x00, 0x00, 0x00, 0x10])

      parser.feed(partial)
      expect(parser.bufferedBytes).toBeGreaterThan(0)

      parser.reset()
      expect(parser.bufferedBytes).toBe(0)
    })
  })

  describe('Round-trip encoding/decoding', () => {
    it('should preserve status messages', () => {
      const original: HoundMessage = { type: 'status', state: 'error', error: 'timeout' }
      const encoded = encodeHoundMessage(original)
      const length = encoded.readUInt32BE(0)
      const payload = encoded.subarray(4, 4 + length)
      const decoded = decodeHoundMessage(new Uint8Array(payload).buffer)

      expect(decoded).toEqual(original)
    })

    it('should preserve metrics messages', () => {
      const original: HoundMessage = { type: 'metrics', processingTime: 99.99, memoryUsed: 2048 }
      const encoded = encodeHoundMessage(original)
      const length = encoded.readUInt32BE(0)
      const payload = encoded.subarray(4, 4 + length)
      const decoded = decodeHoundMessage(new Uint8Array(payload).buffer)

      expect(decoded.type).toBe(original.type)
      if (decoded.type === 'metrics') {
        expect(decoded.processingTime).toBeCloseTo(original.processingTime)
        expect(decoded.memoryUsed).toBeCloseTo(original.memoryUsed)
      }
    })

    it('should preserve analysis messages', () => {
      const original: HoundMessage = {
        type: 'analysis',
        hash: 'feedbeef',
        entropy: 7.91,
        contentType: 'binary',
        sizeBytes: 512,
      }
      const encoded = encodeHoundMessage(original)
      const length = encoded.readUInt32BE(0)
      const payload = encoded.subarray(4, 4 + length)
      const decoded = decodeHoundMessage(new Uint8Array(payload).buffer)

      expect(decoded).toEqual(original)
    })
  })
})
