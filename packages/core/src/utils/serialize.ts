/**
 * Deterministic JSON serialization with sorted keys.
 */

import type { JsonSerializable } from '../types/common.js'

/**
 * Serialize a value to a deterministic JSON string.
 * Object keys are sorted to ensure identical payloads produce identical strings
 * regardless of key insertion order.
 *
 * @param value - JSON-serializable value
 * @returns Deterministic JSON string
 */
export function serialize(value: JsonSerializable): string {
  return JSON.stringify(value, (_, v: unknown) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {}
      const obj = v as Record<string, unknown>
      Object.keys(obj)
        .sort()
        .forEach((key) => {
          sorted[key] = obj[key]
        })
      return sorted
    }
    return v
  })
}
