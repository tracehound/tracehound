/**
 * Scent - the input unit to Tracehound Agent.
 */

import type { JsonSerializable } from './common.js'

/**
 * A scent represents a captured request/event to be analyzed.
 * The payload is constrained to JsonSerializable for deterministic hashing.
 */
export interface Scent {
  /** Unique identifier for this scent */
  id: string
  /** Request/event payload - must be JSON serializable */
  payload: JsonSerializable
  /** Origin identifier (IP, user agent, service name) */
  source: string
  /** Capture timestamp (milliseconds since epoch) */
  timestamp: number
}
