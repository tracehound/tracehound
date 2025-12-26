/**
 * Trust Boundary Configuration
 *
 * Developer-defined trust levels for external integrations.
 * RFC-0000: "Biz default'ları sağlıyoruz, sınırları developer çiziyor."
 *
 * SECURITY MODEL:
 * - 'trusted': No additional verification
 * - 'verify': Cross-check with internal state
 * - 'untrusted': Full validation, limited access
 * - 'write-only': Can only receive, cannot query
 */

/**
 * Trust level for cluster/shared state.
 */
export type ClusterTrustLevel = 'trusted' | 'untrusted'

/**
 * Trust level for cold storage.
 */
export type ColdStorageTrustLevel = 'write-only' | 'untrusted'

/**
 * Trust level for external detectors.
 */
export type DetectorTrustLevel = 'trusted' | 'verify'

/**
 * Cluster configuration.
 */
export interface ClusterBoundaryConfig {
  /** Shared state backend */
  sharedState: 'redis' | 'memory' | 'none'
  /** Trust level for cluster peers. Default: 'untrusted' */
  trustLevel: ClusterTrustLevel
}

/**
 * Cold storage boundary configuration.
 */
export interface ColdStorageBoundaryConfig {
  /** Storage endpoint URL */
  endpoint: string
  /** Trust level. Default: 'write-only' */
  trustLevel: ColdStorageTrustLevel
}

/**
 * Detector boundary configuration.
 */
export interface DetectorBoundaryConfig {
  /** Detector source */
  source: 'external' | 'internal'
  /** Trust level. Default: 'trusted' for internal, 'verify' for external */
  trustLevel: DetectorTrustLevel
}

/**
 * Complete trust boundary configuration.
 */
export interface TrustBoundaryConfig {
  /** Cluster/shared state boundaries */
  cluster?: ClusterBoundaryConfig
  /** Cold storage boundaries */
  coldStorage?: ColdStorageBoundaryConfig
  /** Detector boundaries */
  detector?: DetectorBoundaryConfig
}

/**
 * Default trust boundary configuration.
 * Conservative defaults: assume untrusted.
 */
export const DEFAULT_TRUST_BOUNDARY: Required<TrustBoundaryConfig> = {
  cluster: {
    sharedState: 'none',
    trustLevel: 'untrusted',
  },
  coldStorage: {
    endpoint: '',
    trustLevel: 'write-only',
  },
  detector: {
    source: 'internal',
    trustLevel: 'trusted',
  },
}

/**
 * Merge partial trust boundary with defaults.
 */
export function mergeTrustBoundary(
  partial?: Partial<TrustBoundaryConfig>
): Required<TrustBoundaryConfig> {
  if (!partial) return { ...DEFAULT_TRUST_BOUNDARY }

  return {
    cluster: { ...DEFAULT_TRUST_BOUNDARY.cluster, ...partial.cluster },
    coldStorage: { ...DEFAULT_TRUST_BOUNDARY.coldStorage, ...partial.coldStorage },
    detector: { ...DEFAULT_TRUST_BOUNDARY.detector, ...partial.detector },
  }
}

/**
 * Validate trust boundary configuration.
 * Returns array of validation errors, empty if valid.
 */
export function validateTrustBoundary(config: TrustBoundaryConfig): string[] {
  const errors: string[] = []

  // Cold storage endpoint required if configured
  if (config.coldStorage && config.coldStorage.endpoint === '') {
    errors.push('coldStorage.endpoint is required when coldStorage is configured')
  }

  // External detector requires 'verify' trust level
  if (config.detector?.source === 'external' && config.detector.trustLevel === 'trusted') {
    errors.push("External detector should use 'verify' trust level, not 'trusted'")
  }

  return errors
}

/**
 * Check if a detector result should be verified based on trust boundary.
 */
export function shouldVerifyDetector(config: TrustBoundaryConfig): boolean {
  return config.detector?.trustLevel === 'verify'
}

/**
 * Check if cluster state should be treated as untrusted.
 */
export function isClusterUntrusted(config: TrustBoundaryConfig): boolean {
  return config.cluster?.trustLevel === 'untrusted'
}
