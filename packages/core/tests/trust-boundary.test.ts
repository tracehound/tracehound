/**
 * Trust Boundary tests.
 */

import { describe, expect, it } from 'vitest'
import type { TrustBoundaryConfig } from '../src/core/trust-boundary.js'
import {
  DEFAULT_TRUST_BOUNDARY,
  isClusterUntrusted,
  mergeTrustBoundary,
  shouldVerifyDetector,
  validateTrustBoundary,
} from '../src/core/trust-boundary.js'

describe('TrustBoundary', () => {
  describe('DEFAULT_TRUST_BOUNDARY', () => {
    it('should have conservative defaults', () => {
      expect(DEFAULT_TRUST_BOUNDARY.cluster.trustLevel).toBe('untrusted')
      expect(DEFAULT_TRUST_BOUNDARY.coldStorage.trustLevel).toBe('write-only')
      expect(DEFAULT_TRUST_BOUNDARY.detector.trustLevel).toBe('trusted')
    })

    it('should have no cluster by default', () => {
      expect(DEFAULT_TRUST_BOUNDARY.cluster.sharedState).toBe('none')
    })
  })

  describe('mergeTrustBoundary', () => {
    it('should return defaults for undefined', () => {
      const result = mergeTrustBoundary(undefined)
      expect(result).toEqual(DEFAULT_TRUST_BOUNDARY)
    })

    it('should merge partial config', () => {
      const result = mergeTrustBoundary({
        cluster: { sharedState: 'redis', trustLevel: 'trusted' },
      })

      expect(result.cluster.sharedState).toBe('redis')
      expect(result.cluster.trustLevel).toBe('trusted')
      expect(result.coldStorage).toEqual(DEFAULT_TRUST_BOUNDARY.coldStorage)
    })
  })

  describe('validateTrustBoundary', () => {
    it('should pass for valid config', () => {
      const config: TrustBoundaryConfig = {
        coldStorage: {
          endpoint: 'https://storage.example.com',
          trustLevel: 'write-only',
        },
      }

      const errors = validateTrustBoundary(config)
      expect(errors).toHaveLength(0)
    })

    it('should warn about empty endpoint', () => {
      const config: TrustBoundaryConfig = {
        coldStorage: {
          endpoint: '',
          trustLevel: 'write-only',
        },
      }

      const errors = validateTrustBoundary(config)
      expect(errors).toContain('coldStorage.endpoint is required when coldStorage is configured')
    })

    it('should warn about trusted external detector', () => {
      const config: TrustBoundaryConfig = {
        detector: {
          source: 'external',
          trustLevel: 'trusted',
        },
      }

      const errors = validateTrustBoundary(config)
      expect(errors[0]).toContain("should use 'verify'")
    })
  })

  describe('shouldVerifyDetector', () => {
    it('should return true for verify trust level', () => {
      const config: TrustBoundaryConfig = {
        detector: { source: 'external', trustLevel: 'verify' },
      }
      expect(shouldVerifyDetector(config)).toBe(true)
    })

    it('should return false for trusted', () => {
      const config: TrustBoundaryConfig = {
        detector: { source: 'internal', trustLevel: 'trusted' },
      }
      expect(shouldVerifyDetector(config)).toBe(false)
    })
  })

  describe('isClusterUntrusted', () => {
    it('should return true for untrusted cluster', () => {
      const config: TrustBoundaryConfig = {
        cluster: { sharedState: 'redis', trustLevel: 'untrusted' },
      }
      expect(isClusterUntrusted(config)).toBe(true)
    })

    it('should return false for trusted cluster', () => {
      const config: TrustBoundaryConfig = {
        cluster: { sharedState: 'redis', trustLevel: 'trusted' },
      }
      expect(isClusterUntrusted(config)).toBe(false)
    })
  })
})
