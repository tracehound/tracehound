/**
 * License Manager - JWT-based license validation for commercial tiers.
 *
 * CRITICAL INVARIANTS:
 * - Soft Lock: Never crash or block production due to license issues
 * - Offline: Public key embedded, no network required
 * - Grace Period: 7 days tolerance for expired licenses
 */

import { createVerify } from 'node:crypto'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * License tiers.
 */
export type LicenseTier = 'community' | 'pro' | 'enterprise'

/**
 * License validation status.
 */
export type LicenseStatus = 'valid' | 'expired' | 'grace' | 'invalid' | 'none'

/**
 * JWT payload for Tracehound licenses.
 */
export interface LicensePayload {
  /** Licensee ID (customer identifier) */
  sub: string
  /** Issuer (must be "tracehound.io") */
  iss: string
  /** Audience (product identifier) */
  aud: string
  /** Expiration timestamp (Unix seconds) */
  exp: number
  /** Issued at timestamp (Unix seconds) */
  iat: number
  /** License tier */
  tier: LicenseTier
  /** Enabled features */
  features: string[]
  /**
   * Maximum concurrent instances allowed.
   * - Pro: 1 (single instance, trust-based)
   * - Enterprise: unlimited (-1) or specific count
   */
  maxInstances?: number
}

/**
 * License validation result.
 */
export interface LicenseValidationResult {
  /** Whether validation succeeded */
  valid: boolean
  /** Resulting tier */
  tier: LicenseTier
  /** Validation status */
  status: LicenseStatus
  /** Error message if invalid */
  error?: string
  /** Days until expiration (negative if expired) */
  daysRemaining?: number
}

/**
 * License Manager configuration.
 */
export interface LicenseManagerConfig {
  /** Public key for signature verification (PEM format) */
  publicKey: string
  /** Expected issuer */
  issuer?: string
  /** Expected audience */
  audience?: string
  /** Grace period in days for expired licenses */
  gracePeriodDays?: number
}

/**
 * License Manager interface.
 */
export interface ILicenseManager {
  /**
   * Validate a license key.
   * @param key - JWT license key
   */
  validate(key: string): LicenseValidationResult

  /**
   * Check if a feature is enabled.
   * @param feature - Feature name
   */
  isFeatureEnabled(feature: string): boolean

  /**
   * Current license tier.
   */
  readonly tier: LicenseTier

  /**
   * Current license status.
   */
  readonly status: LicenseStatus

  /**
   * Current license payload (if valid).
   */
  readonly payload: LicensePayload | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_ISSUER = 'tracehound.io'
const DEFAULT_AUDIENCE = 'tracehound-core'
const DEFAULT_GRACE_PERIOD_DAYS = 7
const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Features available per tier.
 */
export const TIER_FEATURES: Record<LicenseTier, readonly string[]> = {
  community: ['agent', 'quarantine', 'rate-limiter', 'watcher', 'scheduler'],
  pro: [
    'agent',
    'quarantine',
    'rate-limiter',
    'watcher',
    'scheduler',
    'cold-storage',
    'notification-api',
    'async-codec',
  ],
  enterprise: [
    'agent',
    'quarantine',
    'rate-limiter',
    'watcher',
    'scheduler',
    'cold-storage',
    'notification-api',
    'async-codec',
    'redis',
    'siem-export',
    'compliance-reports',
  ],
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * License Manager implementation.
 */
export class LicenseManager implements ILicenseManager {
  private readonly config: Required<LicenseManagerConfig>
  private _tier: LicenseTier = 'community'
  private _status: LicenseStatus = 'none'
  private _payload: LicensePayload | null = null
  private _features: Set<string> = new Set(TIER_FEATURES.community)

  constructor(config: LicenseManagerConfig) {
    this.config = {
      publicKey: config.publicKey,
      issuer: config.issuer ?? DEFAULT_ISSUER,
      audience: config.audience ?? DEFAULT_AUDIENCE,
      gracePeriodDays: config.gracePeriodDays ?? DEFAULT_GRACE_PERIOD_DAYS,
    }
  }

  get tier(): LicenseTier {
    return this._tier
  }

  get status(): LicenseStatus {
    return this._status
  }

  get payload(): LicensePayload | null {
    return this._payload
  }

  validate(key: string): LicenseValidationResult {
    // Empty key = community mode
    if (!key || key.trim() === '') {
      return this.setCommunity('none')
    }

    try {
      // Parse JWT
      const parts = key.split('.')
      if (parts.length !== 3) {
        return this.setCommunity('invalid', 'Invalid JWT format')
      }

      const [headerB64, payloadB64, signatureB64] = parts as [string, string, string]

      // Verify signature
      if (!this.verifySignature(headerB64, payloadB64, signatureB64)) {
        return this.setCommunity('invalid', 'Invalid signature')
      }

      // Decode payload
      const payload = this.decodePayload(payloadB64)
      if (!payload) {
        return this.setCommunity('invalid', 'Invalid payload')
      }

      // Validate issuer
      if (payload.iss !== this.config.issuer) {
        return this.setCommunity('invalid', `Invalid issuer: ${payload.iss}`)
      }

      // Validate audience
      if (payload.aud !== this.config.audience) {
        return this.setCommunity('invalid', `Invalid audience: ${payload.aud}`)
      }

      // Check expiration
      const now = Date.now()
      const expMs = payload.exp * 1000
      const daysRemaining = Math.floor((expMs - now) / MS_PER_DAY)

      if (now > expMs) {
        // Expired - check grace period
        const daysSinceExpiry = Math.floor((now - expMs) / MS_PER_DAY)
        if (daysSinceExpiry <= this.config.gracePeriodDays) {
          // Grace period - still allow full features
          return this.setValid(payload, 'grace', daysRemaining)
        } else {
          // Beyond grace period - community mode
          return this.setCommunity('expired', 'License expired beyond grace period')
        }
      }

      // Valid license
      return this.setValid(payload, 'valid', daysRemaining)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return this.setCommunity('invalid', message)
    }
  }

  isFeatureEnabled(feature: string): boolean {
    return this._features.has(feature)
  }

  // ─── Private Methods ─────────────────────────────────────────────────────────

  private verifySignature(headerB64: string, payloadB64: string, signatureB64: string): boolean {
    try {
      const signatureInput = `${headerB64}.${payloadB64}`
      const signature = Buffer.from(this.base64UrlDecode(signatureB64), 'base64')

      const verifier = createVerify('RSA-SHA256')
      verifier.update(signatureInput)

      return verifier.verify(this.config.publicKey, signature)
    } catch {
      return false
    }
  }

  private decodePayload(payloadB64: string): LicensePayload | null {
    try {
      const json = Buffer.from(this.base64UrlDecode(payloadB64), 'base64').toString('utf8')
      const payload = JSON.parse(json) as LicensePayload

      // Validate required fields
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.iss !== 'string' ||
        typeof payload.aud !== 'string' ||
        typeof payload.exp !== 'number' ||
        typeof payload.iat !== 'number' ||
        typeof payload.tier !== 'string' ||
        !Array.isArray(payload.features)
      ) {
        return null
      }

      // Validate tier
      if (!['community', 'pro', 'enterprise'].includes(payload.tier)) {
        return null
      }

      return payload
    } catch {
      return null
    }
  }

  private base64UrlDecode(str: string): string {
    // Convert base64url to base64
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/')

    // Add padding if needed
    const padding = 4 - (base64.length % 4)
    if (padding !== 4) {
      base64 += '='.repeat(padding)
    }

    return base64
  }

  private setCommunity(status: LicenseStatus, error?: string): LicenseValidationResult {
    this._tier = 'community'
    this._status = status
    this._payload = null
    this._features = new Set(TIER_FEATURES.community)

    const result: LicenseValidationResult = {
      valid: false,
      tier: 'community',
      status,
    }

    if (error !== undefined) {
      result.error = error
    }

    return result
  }

  private setValid(
    payload: LicensePayload,
    status: 'valid' | 'grace',
    daysRemaining: number
  ): LicenseValidationResult {
    this._tier = payload.tier
    this._status = status
    this._payload = payload

    // Set features from tier + any additional from payload
    const tierFeatures = TIER_FEATURES[payload.tier] ?? TIER_FEATURES.community
    this._features = new Set([...tierFeatures, ...payload.features])

    return {
      valid: true,
      tier: payload.tier,
      status,
      daysRemaining,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a License Manager instance.
 *
 * @param config - License manager configuration
 */
export function createLicenseManager(config: LicenseManagerConfig): ILicenseManager {
  return new LicenseManager(config)
}
