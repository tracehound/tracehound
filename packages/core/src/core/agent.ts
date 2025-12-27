/**
 * Agent - core orchestrator for Tracehound intercept flow.
 *
 * SECURITY: Agent does NOT perform threat detection.
 * Agent orchestrates: rate limiting → validation → factory → quarantine.
 *
 * RFC Contract:
 * - If scent.threat present → quarantine
 * - If scent.threat absent → clean
 * - Tracehound DOES NOT make threat decisions
 */

import type { TracehoundError } from '../types/errors.js'
import type { InterceptResult } from '../types/result.js'
import type { Scent } from '../types/scent.js'
import type { IEvidenceFactory } from './evidence-factory.js'
import type { Quarantine } from './quarantine.js'
import type { IRateLimiter, RateLimitResult } from './rate-limiter.js'

/**
 * Agent configuration (subset of TracehoundConfig).
 */
export interface AgentConfig {
  /** Maximum payload size in bytes */
  maxPayloadSize: number
}

/**
 * Agent interface.
 */
export interface IAgent {
  /**
   * Intercept a scent and process according to RFC.
   *
   * Flow:
   * 1. Rate limit check → rate_limited
   * 2. If no threat signal → clean
   * 3. Validate & encode payload → payload_too_large | error
   * 4. Generate signature via factory
   * 5. Check duplicate → ignored
   * 6. Create evidence & quarantine → quarantined
   *
   * @param scent - Input scent to process
   * @returns Intercept result
   */
  intercept(scent: Scent): InterceptResult
}

/**
 * Agent statistics.
 */
export interface AgentStats {
  /** Total intercepts processed */
  totalIntercepts: number
  /** Clean (no threat signal) */
  cleanCount: number
  /** Rate limited */
  rateLimitedCount: number
  /** Payload validation failures */
  validationFailures: number
  /** Duplicates ignored */
  ignoredCount: number
  /** Successfully quarantined */
  quarantinedCount: number
  /** Errors */
  errorCount: number
}

/**
 * Agent implementation.
 */
export class Agent implements IAgent {
  private readonly stats: AgentStats = {
    totalIntercepts: 0,
    cleanCount: 0,
    rateLimitedCount: 0,
    validationFailures: 0,
    ignoredCount: 0,
    quarantinedCount: 0,
    errorCount: 0,
  }

  constructor(
    private readonly config: AgentConfig,
    private readonly quarantine: Quarantine,
    private readonly rateLimiter: IRateLimiter,
    private readonly evidenceFactory: IEvidenceFactory
  ) {
    // Validate config
    if (config.maxPayloadSize <= 0) {
      throw new Error('maxPayloadSize must be positive')
    }
  }

  intercept(scent: Scent): InterceptResult {
    this.stats.totalIntercepts++

    try {
      // Step 1: Rate limit check
      const rateResult = this.rateLimiter.check(scent.source)
      if (!rateResult.allowed) {
        this.stats.rateLimitedCount++
        return {
          status: 'rate_limited',
          retryAfter: (rateResult as Extract<RateLimitResult, { allowed: false }>).retryAfter,
        }
      }

      // Step 2: Check for threat signal
      if (!scent.threat) {
        // No threat signal = clean
        // Tracehound does NOT make threat detection decisions
        this.stats.cleanCount++
        return { status: 'clean' }
      }

      // Step 3: Create evidence via factory
      // Factory handles: validation, encoding, hashing, signature generation
      const creationResult = this.evidenceFactory.create(
        scent,
        scent.threat,
        this.config.maxPayloadSize
      )

      if (!creationResult.ok) {
        // Check if it's a payload size error
        if (creationResult.error.code === 'AGENT_PAYLOAD_TOO_LARGE') {
          this.stats.validationFailures++
          return {
            status: 'payload_too_large',
            limit: this.config.maxPayloadSize,
          }
        }

        // Other errors
        this.stats.errorCount++
        return {
          status: 'error',
          error: creationResult.error,
        }
      }

      const { evidence, signature } = creationResult

      // Step 4: Check for duplicate in quarantine
      if (this.quarantine.has(signature)) {
        // Duplicate - already have evidence for this signature
        // Evidence was created but not needed, dispose it
        evidence.neutralize('')
        this.stats.ignoredCount++
        return {
          status: 'ignored',
          signature,
        }
      }

      // Step 5: Insert into quarantine
      const insertResult = this.quarantine.insert(evidence)

      if (insertResult.status === 'duplicate') {
        // Race condition: became duplicate between has() and insert()
        // Evidence already disposed by duplicate detection
        this.stats.ignoredCount++
        return {
          status: 'ignored',
          signature,
        }
      }

      // Success
      this.stats.quarantinedCount++
      return {
        status: 'quarantined',
        handle: evidence,
      }
    } catch (error: unknown) {
      this.stats.errorCount++

      const tracehoundError: TracehoundError = {
        state: 'agent',
        code: 'INTERCEPT_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error during intercept',
        context: { scentId: scent.id },
        recoverable: false,
      }

      return {
        status: 'error',
        error: tracehoundError,
      }
    }
  }

  /**
   * Get current agent statistics.
   */
  getStats(): Readonly<AgentStats> {
    return { ...this.stats }
  }
}

/**
 * Create an agent instance.
 *
 * @param config - Agent configuration
 * @param quarantine - Quarantine instance
 * @param rateLimiter - Rate limiter instance
 * @param evidenceFactory - Evidence factory instance
 * @returns Agent instance
 */
export function createAgent(
  config: AgentConfig,
  quarantine: Quarantine,
  rateLimiter: IRateLimiter,
  evidenceFactory: IEvidenceFactory
): IAgent {
  return new Agent(config, quarantine, rateLimiter, evidenceFactory)
}
