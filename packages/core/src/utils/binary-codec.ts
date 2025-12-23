/**
 * Binary Codec - gzip encoding for evidence storage.
 *
 * SECURITY INVARIANT:
 * - `encode()` used in hot-path (Agent → EvidenceFactory)
 * - `decode()` ONLY for cold storage / forensics
 * - Agent / Hound Pool MUST NOT have access to decode
 */

import { gunzipSync, gzipSync } from 'node:zlib'

/**
 * Hot-path codec interface.
 * Used by Agent, EvidenceFactory, Hound Pool.
 * NO decode access - security by design.
 */
export interface HotPathCodec {
  /**
   * Encode bytes to compressed format.
   * Used in hot-path for evidence creation.
   */
  encode(bytes: Uint8Array): Uint8Array
}

/**
 * Cold-path codec interface.
 * Used ONLY for: evacuate, cold storage retrieval, forensics.
 * Extends HotPathCodec with decode capability.
 */
export interface ColdPathCodec extends HotPathCodec {
  /**
   * Decode compressed bytes back to original.
   * NOT used in Agent/Hound hot-path.
   */
  decode(bytes: Uint8Array): Uint8Array
}

/**
 * Codec statistics.
 */
export interface CodecStats {
  /** Total encode operations */
  encodeCount: number
  /** Total decode operations */
  decodeCount: number
  /** Total bytes before encoding */
  totalInputBytes: number
  /** Total bytes after encoding */
  totalOutputBytes: number
  /** Average compression ratio */
  compressionRatio: number
}

/**
 * Gzip codec implementation.
 * Provides both hot-path and cold-path capabilities.
 *
 * USAGE:
 * - Pass as HotPathCodec to Agent/EvidenceFactory
 * - Pass as ColdPathCodec only to cold storage / forensics tools
 */
export class GzipCodec implements ColdPathCodec {
  private _encodeCount = 0
  private _decodeCount = 0
  private _totalInputBytes = 0
  private _totalOutputBytes = 0

  /**
   * Encode bytes using gzip compression.
   * Sync operation for hot-path performance.
   */
  encode(bytes: Uint8Array): Uint8Array {
    this._encodeCount++
    this._totalInputBytes += bytes.length

    const compressed = gzipSync(bytes, {
      level: 6, // Balanced speed/compression
    })

    const result = new Uint8Array(compressed)
    this._totalOutputBytes += result.length

    return result
  }

  /**
   * Decode gzip compressed bytes.
   * ONLY for cold storage retrieval / forensics.
   */
  decode(bytes: Uint8Array): Uint8Array {
    this._decodeCount++

    const decompressed = gunzipSync(bytes)
    return new Uint8Array(decompressed)
  }

  /**
   * Get codec statistics (immutable snapshot).
   */
  get stats(): Readonly<CodecStats> {
    const ratio = this._totalInputBytes > 0 ? this._totalOutputBytes / this._totalInputBytes : 0

    return Object.freeze({
      encodeCount: this._encodeCount,
      decodeCount: this._decodeCount,
      totalInputBytes: this._totalInputBytes,
      totalOutputBytes: this._totalOutputBytes,
      compressionRatio: ratio,
    })
  }
}

/**
 * Create a hot-path codec (encode only).
 * Use this for Agent / EvidenceFactory.
 *
 * @returns HotPathCodec with no decode access
 */
export function createHotPathCodec(): HotPathCodec {
  const codec = new GzipCodec()
  // Return only HotPathCodec interface - no decode access
  return {
    encode: (bytes: Uint8Array) => codec.encode(bytes),
  }
}

/**
 * Create a cold-path codec (encode + decode).
 * Use ONLY for cold storage / forensics.
 *
 * @returns ColdPathCodec with full access
 */
export function createColdPathCodec(): ColdPathCodec {
  return new GzipCodec()
}
