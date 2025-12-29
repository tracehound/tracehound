import { createSign, generateKeyPairSync } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { LicensePayload } from '../src/core/license-manager.js'
import { createLicenseManager, LicenseManager, TIER_FEATURES } from '../src/core/license-manager.js'

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Generate test key pair
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

function createTestJWT(payload: Partial<LicensePayload>, usePrivateKey = privateKey): string {
  const header = { alg: 'RS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)

  const fullPayload: LicensePayload = {
    sub: 'test-customer',
    iss: 'tracehound.io',
    aud: 'tracehound-core',
    exp: now + 86400 * 30, // 30 days from now
    iat: now,
    tier: 'pro',
    features: [],
    ...payload,
  }

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url')
  const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString('base64url')
  const signatureInput = `${headerB64}.${payloadB64}`

  const signer = createSign('RSA-SHA256')
  signer.update(signatureInput)
  const signature = signer.sign(usePrivateKey, 'base64url')

  return `${headerB64}.${payloadB64}.${signature}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('LicenseManager', () => {
  let manager: LicenseManager

  beforeEach(() => {
    manager = new LicenseManager({ publicKey: publicKey as string })
  })

  describe('constructor', () => {
    it('initializes with community tier', () => {
      expect(manager.tier).toBe('community')
      expect(manager.status).toBe('none')
      expect(manager.payload).toBeNull()
    })
  })

  describe('validate', () => {
    it('returns community mode for empty key', () => {
      const result = manager.validate('')
      expect(result.valid).toBe(false)
      expect(result.tier).toBe('community')
      expect(result.status).toBe('none')
    })

    it('returns community mode for whitespace-only key', () => {
      const result = manager.validate('   ')
      expect(result.valid).toBe(false)
      expect(result.status).toBe('none')
    })

    it('validates a valid pro license', () => {
      const jwt = createTestJWT({ tier: 'pro' })
      const result = manager.validate(jwt)

      expect(result.valid).toBe(true)
      expect(result.tier).toBe('pro')
      expect(result.status).toBe('valid')
      expect(result.daysRemaining).toBeGreaterThan(0)
    })

    it('validates a valid enterprise license', () => {
      const jwt = createTestJWT({ tier: 'enterprise' })
      const result = manager.validate(jwt)

      expect(result.valid).toBe(true)
      expect(result.tier).toBe('enterprise')
      expect(result.status).toBe('valid')
    })

    it('rejects invalid JWT format', () => {
      const result = manager.validate('not.a.valid.jwt.token')
      expect(result.valid).toBe(false)
      expect(result.status).toBe('invalid')
      expect(result.error).toBe('Invalid JWT format')
    })

    it('rejects JWT with wrong issuer', () => {
      const jwt = createTestJWT({ iss: 'wrong-issuer' })
      const result = manager.validate(jwt)

      expect(result.valid).toBe(false)
      expect(result.status).toBe('invalid')
      expect(result.error).toContain('Invalid issuer')
    })

    it('rejects JWT with wrong audience', () => {
      const jwt = createTestJWT({ aud: 'wrong-audience' })
      const result = manager.validate(jwt)

      expect(result.valid).toBe(false)
      expect(result.status).toBe('invalid')
      expect(result.error).toContain('Invalid audience')
    })

    it('rejects JWT with invalid signature', () => {
      // Create JWT with different key pair
      const { privateKey: otherPrivateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      })

      const jwt = createTestJWT({ tier: 'pro' }, otherPrivateKey as string)
      const result = manager.validate(jwt)

      expect(result.valid).toBe(false)
      expect(result.status).toBe('invalid')
      expect(result.error).toBe('Invalid signature')
    })

    it('enters grace period for recently expired license', () => {
      const now = Math.floor(Date.now() / 1000)
      // Expired 3 days ago (within 7-day grace period)
      const jwt = createTestJWT({ exp: now - 86400 * 3 })
      const result = manager.validate(jwt)

      expect(result.valid).toBe(true)
      expect(result.status).toBe('grace')
      expect(result.daysRemaining).toBeLessThan(0)
    })

    it('rejects license expired beyond grace period', () => {
      const now = Math.floor(Date.now() / 1000)
      // Expired 10 days ago (beyond 7-day grace period)
      const jwt = createTestJWT({ exp: now - 86400 * 10 })
      const result = manager.validate(jwt)

      expect(result.valid).toBe(false)
      expect(result.tier).toBe('community')
      expect(result.status).toBe('expired')
      expect(result.error).toContain('grace period')
    })
  })

  describe('isFeatureEnabled', () => {
    it('has community features by default', () => {
      expect(manager.isFeatureEnabled('agent')).toBe(true)
      expect(manager.isFeatureEnabled('quarantine')).toBe(true)
      expect(manager.isFeatureEnabled('rate-limiter')).toBe(true)
    })

    it('does not have pro features by default', () => {
      expect(manager.isFeatureEnabled('cold-storage')).toBe(false)
      expect(manager.isFeatureEnabled('notification-api')).toBe(false)
    })

    it('enables pro features after pro license validation', () => {
      const jwt = createTestJWT({ tier: 'pro' })
      manager.validate(jwt)

      expect(manager.isFeatureEnabled('cold-storage')).toBe(true)
      expect(manager.isFeatureEnabled('notification-api')).toBe(true)
      expect(manager.isFeatureEnabled('redis')).toBe(false)
    })

    it('enables all features after enterprise license validation', () => {
      const jwt = createTestJWT({ tier: 'enterprise' })
      manager.validate(jwt)

      expect(manager.isFeatureEnabled('cold-storage')).toBe(true)
      expect(manager.isFeatureEnabled('notification-api')).toBe(true)
      expect(manager.isFeatureEnabled('redis')).toBe(true)
      expect(manager.isFeatureEnabled('siem-export')).toBe(true)
    })

    it('respects additional features from payload', () => {
      const jwt = createTestJWT({
        tier: 'pro',
        features: ['custom-feature'],
      })
      manager.validate(jwt)

      expect(manager.isFeatureEnabled('custom-feature')).toBe(true)
    })
  })

  describe('tier state after validation', () => {
    it('updates tier after successful validation', () => {
      const jwt = createTestJWT({ tier: 'enterprise' })
      manager.validate(jwt)

      expect(manager.tier).toBe('enterprise')
      expect(manager.status).toBe('valid')
      expect(manager.payload).not.toBeNull()
      expect(manager.payload?.tier).toBe('enterprise')
    })

    it('reverts to community after invalid validation', () => {
      // First, validate with a valid license
      const validJwt = createTestJWT({ tier: 'enterprise' })
      manager.validate(validJwt)
      expect(manager.tier).toBe('enterprise')

      // Then, validate with an invalid license
      const invalidResult = manager.validate('invalid.jwt.token')
      expect(invalidResult.tier).toBe('community')
      expect(manager.tier).toBe('community')
      expect(manager.status).toBe('invalid')
    })
  })

  describe('factory function', () => {
    it('creates a license manager instance', () => {
      const lm = createLicenseManager({ publicKey: publicKey as string })
      expect(lm.tier).toBe('community')
    })
  })

  describe('TIER_FEATURES constant', () => {
    it('has correct community features', () => {
      expect(TIER_FEATURES.community).toContain('agent')
      expect(TIER_FEATURES.community).toContain('quarantine')
      expect(TIER_FEATURES.community).not.toContain('cold-storage')
    })

    it('has correct pro features', () => {
      expect(TIER_FEATURES.pro).toContain('cold-storage')
      expect(TIER_FEATURES.pro).toContain('notification-api')
      expect(TIER_FEATURES.pro).not.toContain('redis')
    })

    it('has correct enterprise features', () => {
      expect(TIER_FEATURES.enterprise).toContain('redis')
      expect(TIER_FEATURES.enterprise).toContain('siem-export')
      expect(TIER_FEATURES.enterprise).toContain('compliance-reports')
    })
  })
})
