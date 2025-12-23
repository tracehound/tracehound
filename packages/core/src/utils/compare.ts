/**
 * Constant-time comparison utilities.
 * Prevents timing attacks on cryptographic comparisons (CWE-208).
 */

import { timingSafeEqual } from 'node:crypto'

/**
 * Perform constant-time string comparison.
 * Uses Node.js crypto.timingSafeEqual internally.
 *
 * IMPORTANT: This MUST be used for all signature/hash comparisons
 * to prevent timing attacks where attackers can statistically
 * analyze response times to guess valid signatures.
 *
 * @param a - First string
 * @param b - Second string
 * @returns True if strings are equal
 */
export function constantTimeEqual(a: string, b: string): boolean {
  // Fast path: different lengths are not equal
  // Length comparison is safe - attacker already knows lengths
  if (a.length !== b.length) {
    return false
  }

  // Convert to buffers for timing-safe comparison
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')

  return timingSafeEqual(aBuf, bBuf)
}

/**
 * Perform constant-time buffer comparison.
 *
 * @param a - First buffer
 * @param b - Second buffer
 * @returns True if buffers are equal
 */
export function constantTimeBufferEqual(
  a: ArrayBuffer | Uint8Array,
  b: ArrayBuffer | Uint8Array
): boolean {
  const aBuf = a instanceof Uint8Array ? a : new Uint8Array(a)
  const bBuf = b instanceof Uint8Array ? b : new Uint8Array(b)

  if (aBuf.length !== bBuf.length) {
    return false
  }

  return timingSafeEqual(aBuf, bBuf)
}
