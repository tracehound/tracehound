/**
 * Scent - the input unit to Tracehound Agent.
 */

import type { Severity } from './common.js'

/** Threat category types */
export type ThreatCategory = 'injection' | 'ddos' | 'flood' | 'spam' | 'malware' | 'unknown'

/**
 * TLS connection metadata for forensic enrichment.
 * Extracted from TLS handshake information when available.
 */
export interface TLSConnectionInfo {
  /** TLS cipher suite name (e.g., "TLS_AES_256_GCM_SHA384") */
  readonly cipherSuite: string
  /** TLS protocol version (e.g., "TLSv1.3") */
  readonly version: string
  /** Application-Layer Protocol Negotiation (e.g., "h2", "http/1.1") */
  readonly alpn?: string
}

/**
 * Source identification with extended entropy.
 * Used for rate limiting and forensic tracking.
 */
export interface ScentSource {
  /** Source IP address */
  readonly ip: string
  /** HTTP User-Agent header */
  readonly userAgent?: string
  /** TLS connection metadata (available for HTTPS connections) */
  readonly tls?: TLSConnectionInfo
}

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
   * Optional raw ingress bytes captured before payload normalization.
   * When present, EvidenceFactory hashes these bytes instead of canonicalized payload bytes.
   */
  readonly ingressBytes?: ArrayBuffer | Uint8Array

  /**
   * Origin identifier with extended entropy.
   * Used for rate limiting and forensic tracking.
   */
  readonly source: ScentSource

  /** Capture timestamp (milliseconds since epoch) */
  readonly timestamp: number

  /**
   * Optional threat signal from external detector.
   * If present, scent will be quarantined.
   * If absent, scent is considered clean.
   */
  readonly threat?: ThreatSignal
}
