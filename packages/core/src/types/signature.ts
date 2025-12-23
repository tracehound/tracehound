/**
 * Signature generation and validation.
 */

import { constantTimeEqual } from '../utils/compare.js'
import { encodePayload } from '../utils/encode.js'
import { hashBuffer } from '../utils/hash.js'
import type { ThreatInput } from './threat.js'

/** Default max payload size for signature generation (1MB) */
const DEFAULT_MAX_PAYLOAD_SIZE = 1_000_000

/**
 * Options for signature generation.
 */
export interface GenerateSignatureOptions {
  /** Maximum payload size in bytes. Default: 1MB */
  maxPayloadSize?: number
}

/**
 * Generate a content-based, collision-resistant threat signature.
 *
 * Format: {category}:{sha256(payload)}
 *
 * Uses deterministic serialization to ensure identical payloads
 * produce identical signatures regardless of key order.
 *
 * SECURITY INVARIANTS:
 * - Validates payload structure (rejects undefined, NaN, Infinity, etc.)
 * - Checks size before hashing (memory exhaustion prevention)
 * - Hashes UTF-8 bytes directly (split-brain prevention)
 *
 * @param threat - Threat input (without signature)
 * @param options - Optional configuration
 * @returns Signature string
 * @throws TracehoundError if payload validation fails
 */
export function generateSignature(
  threat: ThreatInput,
  options: GenerateSignatureOptions = {}
): string {
  const maxSize = options.maxPayloadSize ?? DEFAULT_MAX_PAYLOAD_SIZE

  // CRITICAL: Use encodePayload for full validation
  // This enforces: structure validation, size check, canonical encoding
  const { bytes } = encodePayload(threat.scent.payload, maxSize)

  const contentHash = hashBuffer(bytes)
  return `${threat.category}:${contentHash}`
}

/**
 * Compare two signatures in constant time.
 * MUST be used for all signature comparisons to prevent timing attacks.
 *
 * @param a - First signature
 * @param b - Second signature
 * @returns True if signatures are equal
 */
export function compareSignatures(a: string, b: string): boolean {
  return constantTimeEqual(a, b)
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
