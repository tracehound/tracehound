/**
 * Scent - the input unit to Tracehound Agent.
 */

import type { Severity } from './common.js'

/** Threat category types */
export type ThreatCategory = 'injection' | 'ddos' | 'flood' | 'spam' | 'malware' | 'unknown'

/**
 * Threat signal from external detector.
 * This is provided by WAF, custom rules, ML models, etc.
 * Tracehound does NOT perform threat detection.
 */
export interface ThreatSignal {
  /** Classification category */
  category: ThreatCategory
  /** Severity level */
  severity: Severity
}

/**
 * JSON primitive types for payload.
 * Re-exported here for convenience.
 */
export type { JsonSerializable } from './common.js'

/**
 * A scent represents a captured request/event to be analyzed.
 *
 * RFC Contract:
 * - If `threat` is present: External detector classified this as malicious → quarantine
 * - If `threat` is absent: No threat signal → clean (no quarantine)
 *
 * Tracehound DOES NOT make threat detection decisions.
 */
export interface Scent {
  /** Unique identifier for this scent */
  readonly id: string

  /**
   * Request/event payload.
   * Must be JSON serializable for deterministic hashing.
   * Size constrained by config.maxPayloadSize.
   */
  readonly payload: import('./common.js').JsonSerializable

  /**
   * Origin identifier (IP, user agent, service name).
   * Used for rate limiting.
   */
  readonly source: string

  /** Capture timestamp (milliseconds since epoch) */
  readonly timestamp: number

  /**
   * Optional threat signal from external detector.
   * If present, scent will be quarantined.
   * If absent, scent is considered clean.
   */
  readonly threat?: ThreatSignal
}
