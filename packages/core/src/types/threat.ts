/**
 * Threat - a classified scent with signature.
 */

import type { Severity } from './common.js'
import type { Scent } from './scent.js'

/** Threat category types */
export type ThreatCategory = 'injection' | 'ddos' | 'flood' | 'spam' | 'malware' | 'unknown'

/**
 * A threat is a scent that has been classified as malicious.
 */
export interface Threat {
  /** Content-based, collision-resistant signature */
  signature: string
  /** Classification category */
  category: ThreatCategory
  /** Severity level */
  severity: Severity
  /** Original scent */
  scent: Scent
}

/**
 * Input for threat classification (before signature generation).
 */
export interface ThreatInput {
  /** Classification category */
  category: ThreatCategory
  /** Severity level */
  severity: Severity
  /** Original scent */
  scent: Scent
}
