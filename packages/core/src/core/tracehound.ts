/**
 * Tracehound - Global factory and runtime instance.
 *
 * Provides a single entry point for initializing Tracehound with license validation.
 */

import { createAgent, type IAgent } from './agent.js'
import { AuditChain } from './audit-chain.js'
import { EvidenceFactory, type IEvidenceFactory } from './evidence-factory.js'
import {
  createLicenseManager,
  TIER_FEATURES,
  type ILicenseManager,
  type LicenseTier,
} from './license-manager.js'
import { createNotificationEmitter, type INotificationEmitter } from './notification-emitter.js'
import { Quarantine } from './quarantine.js'
import { createRateLimiter, type IRateLimiter } from './rate-limiter.js'
import { createWatcher, type IWatcher } from './watcher.js'

// ─────────────────────────────────────────────────────────────────────────────
// Environment Variable Name
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Environment variable name for public key.
 * Can be overridden via options.publicKey.
 */
const PUBLIC_KEY_ENV = 'TRACEHOUND_PUBLIC_KEY'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tracehound initialization options.
 */
export interface TracehoundOptions {
  /**
   * License key (JWT format).
   * If omitted, runs in Community mode.
   */
  licenseKey?: string

  /**
   * Public key for license verification (PEM format).
   * If omitted, reads from TRACEHOUND_PUBLIC_KEY environment variable.
   * If neither provided, license validation is skipped (Community mode).
   */
  publicKey?: string

  /**
   * Maximum payload size in bytes.
   * @default 1_000_000
   */
  maxPayloadSize?: number

  /**
   * Quarantine configuration.
   */
  quarantine?: {
    maxCount?: number
    maxBytes?: number
  }

  /**
   * Rate limiter configuration.
   */
  rateLimit?: {
    windowMs?: number
    maxRequests?: number
    blockDurationMs?: number
  }

  /**
   * Watcher configuration.
   */
  watcher?: {
    maxAlertsPerWindow?: number
    alertWindowMs?: number
    quarantineHighWatermark?: number
  }
}

/**
 * Tracehound runtime instance.
 */
export interface ITracehound {
  /** The Agent for intercepting requests */
  readonly agent: IAgent
  /** The Quarantine storage */
  readonly quarantine: Quarantine
  /** The Rate Limiter */
  readonly rateLimiter: IRateLimiter
  /** The Watcher for observability */
  readonly watcher: IWatcher
  /** The License Manager */
  readonly license: ILicenseManager
  /** The Audit Chain */
  readonly auditChain: AuditChain
  /** The Notification Emitter */
  readonly notifications: INotificationEmitter

  /**
   * Current license tier.
   */
  readonly tier: LicenseTier

  /**
   * Check if a feature is enabled.
   */
  isFeatureEnabled(feature: string): boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tracehound runtime implementation.
 */
class Tracehound implements ITracehound {
  readonly agent: IAgent
  readonly quarantine: Quarantine
  readonly rateLimiter: IRateLimiter
  readonly watcher: IWatcher
  readonly license: ILicenseManager
  readonly auditChain: AuditChain
  readonly notifications: INotificationEmitter

  private readonly evidenceFactory: IEvidenceFactory

  constructor(options: TracehoundOptions = {}) {
    // Resolve public key: options > env > none (Community mode)
    const publicKey = options.publicKey ?? process.env[PUBLIC_KEY_ENV]

    // Initialize license manager (only if public key available)
    if (publicKey) {
      this.license = createLicenseManager({ publicKey })

      // Validate license if key provided
      if (options.licenseKey) {
        this.license.validate(options.licenseKey)
      }
    } else {
      // No public key = Community mode (creates a "dummy" license manager)
      this.license = createLicenseManager({ publicKey: '' })
      // Note: Empty publicKey will fail validation, resulting in Community tier
    }

    // Initialize components
    this.auditChain = new AuditChain()
    this.notifications = createNotificationEmitter()

    this.quarantine = new Quarantine(
      {
        maxCount: options.quarantine?.maxCount ?? 10_000,
        maxBytes: options.quarantine?.maxBytes ?? 100_000_000,
        evictionPolicy: 'priority',
      },
      this.auditChain
    )

    this.rateLimiter = createRateLimiter({
      windowMs: options.rateLimit?.windowMs ?? 60_000,
      maxRequests: options.rateLimit?.maxRequests ?? 100,
      blockDurationMs: options.rateLimit?.blockDurationMs ?? 300_000,
    })

    this.watcher = createWatcher({
      maxAlertsPerWindow: options.watcher?.maxAlertsPerWindow ?? 10,
      alertWindowMs: options.watcher?.alertWindowMs ?? 60_000,
      quarantineHighWatermark: options.watcher?.quarantineHighWatermark ?? 0.8,
    })

    this.evidenceFactory = new EvidenceFactory()

    // Create agent
    this.agent = createAgent(
      { maxPayloadSize: options.maxPayloadSize ?? 1_000_000 },
      this.quarantine,
      this.rateLimiter,
      this.evidenceFactory
    )
  }

  get tier(): LicenseTier {
    return this.license.tier
  }

  isFeatureEnabled(feature: string): boolean {
    return this.license.isFeatureEnabled(feature)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Tracehound instance.
 *
 * @example
 * ```typescript
 * import { createTracehound } from '@tracehound/core'
 *
 * const tracehound = createTracehound({
 *   licenseKey: process.env.TRACEHOUND_LICENSE_KEY,
 * })
 *
 * // Use agent
 * const result = tracehound.agent.intercept(scent)
 *
 * // Check license
 * console.log(`Running in ${tracehound.tier} mode`)
 * ```
 *
 * @param options - Initialization options
 */
export function createTracehound(options: TracehoundOptions = {}): ITracehound {
  return new Tracehound(options)
}

export { TIER_FEATURES }
