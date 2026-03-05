/**
 * Hound process analysis behavior tests.
 */

import { describe, expect, it } from 'vitest'
import { analyzePayload } from '../src/core/hound-analysis.js'
import { decodeHoundMessage, encodeHoundMessage, type HoundMessage } from '../src/core/hound-ipc.js'

describe('HoundProcess Analysis', () => {
  it('produces deterministic hash for identical payload', () => {
    const payload = new TextEncoder().encode('{"hello":"world"}').buffer
    const a = analyzePayload(payload)
    const b = analyzePayload(payload)

    expect(a.hash).toBe(b.hash)
    expect(a.sizeBytes).toBe(17)
  })

  it('detects json content type', () => {
    const payload = new TextEncoder().encode('{"ok":true}').buffer
    const analysis = analyzePayload(payload)

    expect(analysis.contentType).toBe('json')
  })

  it('detects binary content type for random-looking bytes', () => {
    const payload = new Uint8Array([0xff, 0x00, 0x13, 0x88, 0x7f, 0xa2]).buffer
    const analysis = analyzePayload(payload)

    expect(analysis.contentType).toBe('binary')
    expect(analysis.entropy).toBeGreaterThan(0)
  })

  it('encodes/decodes analysis IPC message round-trip', () => {
    const analysis: HoundMessage = {
      type: 'analysis',
      hash: 'deadbeef',
      entropy: 6.33,
      contentType: 'text',
      sizeBytes: 42,
    }
    const encoded = encodeHoundMessage(analysis)
    const length = encoded.readUInt32BE(0)
    const payload = encoded.subarray(4, 4 + length)
    const decoded = decodeHoundMessage(new Uint8Array(payload).buffer)

    expect(decoded).toEqual(analysis)
  })
})
