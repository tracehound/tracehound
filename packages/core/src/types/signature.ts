/**
 * Signature generation and validation.
 */

import { hash } from '../utils/hash.js'
import { serialize } from '../utils/serialize.js'
import type { ThreatInput } from './threat.js'

/**
 * Generate a content-based, collision-resistant threat signature.
 *
 * Format: {category}:{sha256(payload)}
 *
 * Uses deterministic serialization to ensure identical payloads
 * produce identical signatures regardless of key order.
 *
 * @param threat - Threat input (without signature)
 * @returns Signature string
 */
export function generateSignature(threat: ThreatInput): string {
  const serialized = serialize(threat.scent.payload)
  const contentHash = hash(serialized)
  return `${threat.category}:${contentHash}`
}

/**
 * Validate a signature format.
 *
 * @param sig - Signature to validate
 * @returns True if valid format
 */
export function validateSignature(sig: string): boolean {
  const colonIndex = sig.indexOf(':')
  if (colonIndex === -1) return false

  const category = sig.slice(0, colonIndex)
  const contentHash = sig.slice(colonIndex + 1)

  // Category must not be empty
  if (category.length === 0) return false

  // Hash must be 64 hex characters (SHA-256)
  if (contentHash.length !== 64) return false
  if (!/^[a-f0-9]+$/.test(contentHash)) return false

  return true
}
