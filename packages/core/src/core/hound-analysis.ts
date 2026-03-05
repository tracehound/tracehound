/**
 * Deterministic payload analysis used by hound child process.
 */

import { createHash } from 'node:crypto'
import type { HoundAnalysisMessage, HoundContentType } from './hound-ipc.js'

/**
 * Compute deterministic analysis metadata for payload bytes.
 */
export function analyzePayload(payload: ArrayBuffer): Omit<HoundAnalysisMessage, 'type'> {
  const bytes = new Uint8Array(payload)
  return {
    hash: createHash('sha256').update(bytes).digest('hex'),
    entropy: calculateShannonEntropy(bytes),
    contentType: detectContentType(bytes),
    sizeBytes: bytes.byteLength,
  }
}

function calculateShannonEntropy(bytes: Uint8Array): number {
  if (bytes.length === 0) {
    return 0
  }

  const freq = new Array<number>(256).fill(0)
  for (const byte of bytes) {
    const current = freq[byte] ?? 0
    freq[byte] = current + 1
  }

  let entropy = 0
  for (const count of freq) {
    if (count === 0) continue
    const p = count / bytes.length
    entropy -= p * Math.log2(p)
  }

  return entropy
}

function detectContentType(bytes: Uint8Array): HoundContentType {
  if (hasPrefix(bytes, [0x1f, 0x8b])) return 'gzip'
  if (hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'zip'
  if (hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46])) return 'pdf'
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'png'
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif'

  const trimmed = trimLeadingWhitespace(bytes)
  if (trimmed.length > 0 && (trimmed[0] === 0x7b || trimmed[0] === 0x5b)) {
    return 'json'
  }

  const sampleLength = Math.min(bytes.length, 512)
  if (sampleLength === 0) {
    return 'unknown'
  }

  let printable = 0
  for (let i = 0; i < sampleLength; i++) {
    const byte = bytes[i]!
    if (byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e)) {
      printable++
    }
  }

  const ratio = printable / sampleLength
  if (ratio >= 0.9) {
    return 'text'
  }

  return 'binary'
}

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) {
    return false
  }

  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) {
      return false
    }
  }

  return true
}

function trimLeadingWhitespace(bytes: Uint8Array): Uint8Array {
  let offset = 0
  while (offset < bytes.length) {
    const byte = bytes[offset]!
    if (byte !== 0x20 && byte !== 0x0a && byte !== 0x0d && byte !== 0x09) {
      break
    }
    offset++
  }

  return bytes.subarray(offset)
}
