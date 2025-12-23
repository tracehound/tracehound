/**
 * Common types used across Tracehound.
 */

/** JSON primitive types */
export type JsonPrimitive = string | number | boolean | null

/** JSON-serializable type for deterministic hashing */
export type JsonSerializable =
  | JsonPrimitive
  | JsonSerializable[]
  | { [key: string]: JsonSerializable }

/** Threat severity levels */
export type Severity = 'low' | 'medium' | 'high' | 'critical'
