/**
 * External coordination contract types (RFC-0009).
 *
 * These types define an optional integration boundary for external
 * coordination providers. They are contract-only and do not introduce
 * runtime coupling into the intercept hot path.
 */

/** Coordination capabilities exposed by a provider. */
export type CoordinationFeature =
  | 'shared_blocklist'
  | 'global_rate_limit'
  | 'mtls_enforcement'
  | 'policy_broker'

/** Coordination health mode for fail-open visibility. */
export type CoordinationMode = 'local' | 'degraded' | 'synchronized'

/** Snapshot of provider synchronization health. */
export interface CoordinationHealth {
  /** Current coordination mode. */
  readonly mode: CoordinationMode
  /** Last successful synchronization timestamp (epoch ms). */
  readonly lastSyncAt: number | null
  /** Observed lag between local and provider state in milliseconds. */
  readonly syncLagMs: number | null
  /** Stable provider identifier for observability. */
  readonly provider: string
}

/** Optional external coordination provider contract. */
export interface CoordinationProvider {
  /** Provider identifier. */
  readonly providerId: string
  /** Supported capability set. */
  readonly features: ReadonlySet<CoordinationFeature>
  /** Start provider lifecycle. */
  start(): Promise<void>
  /** Stop provider lifecycle. */
  stop(): Promise<void>
  /** Return current coordination health snapshot. */
  health(): CoordinationHealth
  /** Optional blocklist synchronization operation. */
  syncBlocklist?(entries: ReadonlyArray<string>): Promise<void>
  /** Optional distributed rate-limit synchronization operation. */
  syncRateLimit?(bucketKey: string, value: number): Promise<void>
}
