/**
 * Threat - a classified scent with signature.
 */

import type { Severity } from './common.js'
import type { Scent, ThreatCategory } from './scent.js'

// Re-export from scent.ts (single source of truth)
export type { ThreatCategory, ThreatSignal } from './scent.js'

/**
 * A threat is a scent that has been classified as malicious
 * and assigned a signature for deduplication.
 */
export interface Threat {
  /** Content-based, collision-resistant signature */
  readonly signature: string
  /** Classification category */
  readonly category: ThreatCategory
  /** Severity level */
  readonly severity: Severity
  /** Original scent */
  readonly scent: Scent
}

/**
 * Input for threat classification (before signature generation).
 * Used internally by EvidenceFactory.
 */
export interface ThreatInput {
  /** Classification category */
  readonly category: ThreatCategory
  /** Severity level */
  readonly severity: Severity
  /** Original scent */
  readonly scent: Scent
}

/**
 * Create ThreatInput from Scent with threat signal.
 * Helper function for type conversion.
 */
export function createThreatInput(scent: Scent): ThreatInput | null {
  if (!scent.threat) {
    return null
  }
  return {
    category: scent.threat.category,
    severity: scent.threat.severity,
    scent,
  }
}
