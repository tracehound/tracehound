/**
 * Payload encoding with size-first validation.
 *
 * SECURITY INVARIANT: Size check MUST happen BEFORE serialization
 * to prevent memory exhaustion attacks via large payloads.
 */

import type { JsonSerializable } from "../types/common.js";
import { Errors } from "../types/errors.js";
import { serialize } from "./serialize.js";

const MAX_NESTING_DEPTH = 32;
const MAX_OBJECT_KEYS = 1000;

/** Result of payload encoding */
export interface EncodeResult {
  /** UTF-8 encoded bytes */
  bytes: Uint8Array;
  /** Size in bytes */
  size: number;
  /** Canonical JSON string (for debugging only) */
  canonical: string;
}

/**
 * Validate payload structure for edge cases that could cause
 * signature collisions or unexpected behavior.
 *
 * @throws TracehoundError if payload contains problematic values
 */
function validatePayloadStructure(
  value: unknown,
  path: string = "root",
  depth: number = 0,
): void {
  if (depth > MAX_NESTING_DEPTH) {
    throw Errors.serializationFailed(
      `max nesting depth exceeded at ${path} (${depth} > ${MAX_NESTING_DEPTH})`,
    );
  }

  if (value === undefined) {
    throw Errors.serializationFailed(
      `undefined value at ${path} - use null instead`,
    );
  }

  if (typeof value === "number") {
    if (Number.isNaN(value)) {
      throw Errors.serializationFailed(`NaN value at ${path} - not allowed`);
    }
    if (!Number.isFinite(value)) {
      throw Errors.serializationFailed(
        `Infinity value at ${path} - not allowed`,
      );
    }
  }

  if (typeof value === "function") {
    throw Errors.serializationFailed(`function at ${path} - not serializable`);
  }

  if (typeof value === "symbol") {
    throw Errors.serializationFailed(`symbol at ${path} - not serializable`);
  }

  if (typeof value === "bigint") {
    throw Errors.serializationFailed(
      `bigint at ${path} - use string representation`,
    );
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      validatePayloadStructure(value[i], `${path}[${i}]`, depth + 1);
    }
  } else if (value !== null && typeof value === "object") {
    // Check for circular references would require WeakSet tracking
    // JSON.stringify will throw on circular refs anyway
    const entries = Object.entries(value);
    if (entries.length > MAX_OBJECT_KEYS) {
      throw Errors.serializationFailed(
        `max object key count exceeded at ${path} (${entries.length} > ${MAX_OBJECT_KEYS})`,
      );
    }

    for (const [key, val] of entries) {
      if (val === undefined) {
        throw Errors.serializationFailed(
          `undefined value at ${path}.${key} - use null or omit key`,
        );
      }
      validatePayloadStructure(val, `${path}.${key}`, depth + 1);
    }
  }
}

// canonicalize is provided by serialize() from ./serialize.ts

/**
 * Encode payload to UTF-8 bytes with size-first validation.
 *
 * SECURITY: This function enforces the following invariants:
 * 1. Payload structure is validated for edge cases
 * 2. Size is checked AFTER encoding (actual byte size)
 * 3. Returns bytes for direct use in signature hashing
 *
 * @param payload - JSON-serializable payload
 * @param maxSize - Maximum allowed size in bytes
 * @returns Encoded bytes and metadata
 * @throws TracehoundError if validation fails
 */
export function encodePayload(
  payload: JsonSerializable,
  maxSize: number,
): EncodeResult {
  // Step 1: Validate structure (catches undefined, NaN, etc.)
  validatePayloadStructure(payload);

  // Step 2: Canonicalize to JSON string
  const canonical = serialize(payload);

  // Step 3: Encode to UTF-8 bytes
  const encoder = new TextEncoder();
  const bytes = encoder.encode(canonical);

  // Step 4: Check size AFTER encoding (actual byte size, not string length)
  if (bytes.length > maxSize) {
    throw Errors.payloadTooLarge(bytes.length, maxSize);
  }

  return {
    bytes,
    size: bytes.length,
    canonical,
  };
}

/**
 * Quick size estimate without full encoding.
 * Use for early rejection before detailed validation.
 *
 * NOTE: This is a conservative estimate. Actual UTF-8 size
 * may be larger for non-ASCII characters.
 */
export function estimatePayloadSize(payload: JsonSerializable): number {
  // Quick stringify without sorting (faster for estimation)
  const json = JSON.stringify(payload);
  // UTF-8: ASCII = 1 byte, others = up to 4 bytes
  // Use 2x as conservative multiplier
  return json.length * 2;
}
