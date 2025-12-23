/**
 * Cryptographic hashing utilities.
 */

import { createHash } from 'node:crypto'

/**
 * Compute SHA-256 hash of a string.
 * Uses synchronous crypto for hot-path performance.
 *
 * @param data - String to hash
 * @returns Lowercase hex string (64 characters)
 */
export function hash(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Compute SHA-256 hash of a buffer.
 *
 * @param data - Buffer to hash
 * @returns Lowercase hex string (64 characters)
 */
export function hashBuffer(data: ArrayBuffer | Uint8Array): string {
  const uint8 = data instanceof Uint8Array ? data : new Uint8Array(data)
  return createHash('sha256').update(uint8).digest('hex')
}
