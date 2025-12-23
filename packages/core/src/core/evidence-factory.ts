/**
 * Evidence Factory - creates Evidence instances with proper hash ownership.
 *
 * SECURITY INVARIANTS:
 * - Factory owns all cryptographic operations
 * - Agent MUST NOT compute hashes or signatures directly
 * - Codec compression is internal to factory
 * - Agent interface remains unchanged
 */

import type { TracehoundError } from '../types/errors.js'
import type { Scent, ThreatSignal } from '../types/scent.js'
import type { HotPathCodec } from '../utils/binary-codec.js'
import { encodePayload } from '../utils/encode.js'
import { hashBuffer } from '../utils/hash.js'
import { Evidence } from './evidence.js'

/**
 * Result of evidence creation.
 */
export type EvidenceCreationResult =
  | {
      ok: true
      /** Created evidence handle */
      evidence: Evidence
      /** Generated signature */
      signature: string
      /** Payload hash (of uncompressed canonical bytes) */
      hash: string
      /** Size in bytes (compressed if codec provided) */
      size: number
      /** Whether compression was applied */
      compressed: boolean
    }
  | {
      ok: false
      /** Error that prevented creation */
      error: TracehoundError
    }

/**
 * Evidence factory options.
 */
export interface EvidenceFactoryOptions {
  /**
   * Optional codec for compression.
   * If provided, evidence bytes will be compressed.
   * Use createHotPathCodec() - NO decode access.
   */
  codec?: HotPathCodec
}

/**
 * Evidence factory interface.
 */
export interface IEvidenceFactory {
  /**
   * Create evidence from scent with threat signal.
   *
   * @param scent - The scent to create evidence from
   * @param threat - Threat signal (category + severity)
   * @param maxPayloadSize - Maximum allowed payload size (before compression)
   * @returns Evidence creation result
   */
  create(scent: Scent, threat: ThreatSignal, maxPayloadSize: number): EvidenceCreationResult
}

/**
 * Evidence factory implementation.
 *
 * Responsibilities:
 * 1. Encode payload (validation + canonical bytes)
 * 2. Compute SHA-256 hash of canonical bytes (BEFORE compression)
 * 3. Optionally compress bytes
 * 4. Generate collision-resistant signature
 * 5. Create Evidence instance with computed values
 *
 * SECURITY: Hash is computed on uncompressed bytes.
 * This ensures signature determinism regardless of compression.
 */
export class EvidenceFactory implements IEvidenceFactory {
  private readonly codec: HotPathCodec | undefined

  constructor(options: EvidenceFactoryOptions = {}) {
    this.codec = options.codec
  }

  create(scent: Scent, threat: ThreatSignal, maxPayloadSize: number): EvidenceCreationResult {
    try {
      // Step 1: Encode payload with validation
      const encoded = encodePayload(scent.payload, maxPayloadSize)

      // Step 2: Compute hash of canonical bytes (BEFORE compression)
      // This ensures signature determinism
      const hash = hashBuffer(encoded.bytes)

      // Step 3: Generate signature (category + hash)
      const signature = `${threat.category}:${hash}`

      // Step 4: Optionally compress bytes
      let finalBytes: Uint8Array
      let compressed = false

      if (this.codec) {
        finalBytes = this.codec.encode(encoded.bytes)
        compressed = true
      } else {
        finalBytes = encoded.bytes
      }

      // Step 5: Create Evidence instance
      const evidence = new Evidence(
        finalBytes.buffer.slice(
          finalBytes.byteOffset,
          finalBytes.byteOffset + finalBytes.byteLength
        ) as ArrayBuffer,
        signature,
        hash,
        threat.severity,
        scent.timestamp,
        compressed
      )

      return {
        ok: true,
        evidence,
        signature,
        hash,
        size: finalBytes.length,
        compressed,
      }
    } catch (error: unknown) {
      // Convert to TracehoundError if not already
      if (this.isTracehoundError(error)) {
        return { ok: false, error }
      }

      // Wrap unknown error
      return {
        ok: false,
        error: {
          state: 'agent',
          code: 'EVIDENCE_CREATION_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error',
          context: { scentId: scent.id },
          recoverable: false,
        },
      }
    }
  }

  private isTracehoundError(error: unknown): error is TracehoundError {
    return (
      typeof error === 'object' &&
      error !== null &&
      'state' in error &&
      'code' in error &&
      'message' in error
    )
  }
}

/**
 * Create an evidence factory instance.
 * Factory function for dependency injection.
 *
 * @param options - Optional configuration including codec
 */
export function createEvidenceFactory(options: EvidenceFactoryOptions = {}): IEvidenceFactory {
  return new EvidenceFactory(options)
}
