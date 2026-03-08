/**
 * Agent - core orchestrator for Tracehound intercept flow.
 *
 * SECURITY: Agent does NOT perform threat detection.
 * Agent orchestrates: rate limiting -> validation -> factory -> quarantine.
 *
 * RFC Contract:
 * - If scent.threat present -> quarantine
 * - If scent.threat absent -> clean
 * - Tracehound DOES NOT make threat decisions
 */

import type {
  CoordinationHealth,
  CoordinationProvider,
} from "../types/coordination.js";
import { Errors } from "../types/errors.js";
import type {
  InterceptResult,
  RuntimeEvidenceHandle,
} from "../types/result.js";
import type { Scent } from "../types/scent.js";
import type { IEvidenceFactory } from "./evidence-factory.js";
import type { IHoundPool } from "./hound-pool.js";
import type { INotificationEmitter } from "./notification-emitter.js";
import { SYSTEM_PANIC_REASONS } from "./operational-events.js";
import type { Quarantine } from "./quarantine.js";
import type { IRateLimiter, RateLimitResult } from "./rate-limiter.js";
import type { IWatcher } from "./watcher.js";

/**
 * Agent configuration (subset of TracehoundConfig).
 */
export interface AgentConfig {
  /** Maximum payload size in bytes */
  maxPayloadSize: number;
  /** Optional external coordination provider (RFC-0009). */
  coordinationProvider?: CoordinationProvider;
}

/**
 * Agent interface.
 */
export interface IAgent {
  /**
   * Intercept a scent and process according to RFC.
   *
   * Flow:
   * 1. Rate limit check -> rate_limited
   * 2. If no threat signal -> clean
   * 3. Validate & encode payload -> payload_too_large | error
   * 4. Generate signature via factory
   * 5. Check duplicate -> ignored
   * 6. Create evidence & quarantine -> quarantined
   *
   * @param scent - Input scent to process
   * @returns Intercept result
   */
  intercept(scent: Scent): InterceptResult;

  /**
   * Return current coordination health snapshot.
   *
   * - No provider => local mode
   * - Provider contract/health error => degraded mode (fail-open)
   */
  getCoordinationHealth(): CoordinationHealth;

  /**
   * Get current agent statistics.
   */
  getStats(): Readonly<AgentStats>;
}

/**
 * Agent statistics.
 */
export interface AgentStats {
  /** Total intercepts processed */
  totalIntercepts: number;
  /** Clean (no threat signal) */
  cleanCount: number;
  /** Rate limited */
  rateLimitedCount: number;
  /** Payload validation failures */
  validationFailures: number;
  /** Duplicates ignored */
  ignoredCount: number;
  /** Successfully quarantined */
  quarantinedCount: number;
  /** Errors */
  errorCount: number;
  /** Coordination fallback transitions (`degraded` or provider failure) */
  coordinationFallbackCount: number;
  /** Coordination warnings emitted via system.panic */
  coordinationWarningCount: number;
  /** Runtime membrane payload egress rejections */
  membraneRejectionCount: number;
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
    coordinationFallbackCount: 0,
    coordinationWarningCount: 0,
    membraneRejectionCount: 0,
  };

  private readonly emittedCoordinationWarnings = new Set<string>();
  private lastCoordinationFallbackKey: string | null = null;

  constructor(
    private readonly config: AgentConfig,
    private readonly quarantine: Quarantine,
    private readonly rateLimiter: IRateLimiter,
    private readonly evidenceFactory: IEvidenceFactory,
    private readonly houndPool?: IHoundPool,
    private readonly watcher?: IWatcher,
    private readonly notifications?: INotificationEmitter,
  ) {
    // Validate config
    if (config.maxPayloadSize <= 0) {
      throw Errors.invalidConfigAgent("maxPayloadSize must be positive");
    }
  }

  intercept(scent: Scent): InterceptResult {
    this.stats.totalIntercepts++;

    try {
      // Step 1: Rate limit check
      const rateResult = this.rateLimiter.check(scent.source);
      if (!rateResult.allowed) {
        this.stats.rateLimitedCount++;
        const retryAfter = (
          rateResult as Extract<RateLimitResult, { allowed: false }>
        ).retryAfter;
        this.runTelemetryHook(() => {
          this.notifications?.emit("rate_limit.exceeded", {
            source: scent.source,
            retryAfterMs: retryAfter,
          });
        });
        return { status: "rate_limited", retryAfter };
      }

      // Step 2: Check for threat signal
      if (!scent.threat) {
        // No threat signal = clean
        // Tracehound does NOT make threat detection decisions
        this.stats.cleanCount++;
        return { status: "clean" };
      }
      const threat = scent.threat;

      // Record threat in Watcher (observability) - before any further processing
      this.runTelemetryHook(() => {
        this.watcher?.recordThreat(threat.category, threat.severity);
      });

      // Step 3: Create evidence via factory
      // Factory handles: validation, encoding, hashing, signature generation
      const creationResult = this.evidenceFactory.create(
        scent,
        threat,
        this.config.maxPayloadSize,
      );

      if (!creationResult.ok) {
        // Check if it's a payload size error
        if (creationResult.error.code === "AGENT_PAYLOAD_TOO_LARGE") {
          this.stats.validationFailures++;
          return {
            status: "payload_too_large",
            limit: this.config.maxPayloadSize,
          };
        }

        // Other errors
        this.stats.errorCount++;
        return {
          status: "error",
          error: creationResult.error,
        };
      }

      const { evidence, signature } = creationResult;

      // Step 4: Check for duplicate in quarantine
      if (this.quarantine.has(signature)) {
        // Duplicate - already have evidence for this signature
        // Evidence was created but not needed, dispose it
        evidence.neutralize("");
        this.stats.ignoredCount++;
        return {
          status: "ignored",
          signature,
        };
      }

      // Step 5: Insert into quarantine
      const insertResult = this.quarantine.insert(evidence);

      if (insertResult.status === "duplicate") {
        // Race condition: became duplicate between has() and insert()
        // Evidence already disposed by duplicate detection
        this.stats.ignoredCount++;
        return {
          status: "ignored",
          signature,
        };
      }

      if (insertResult.status === "dropped") {
        // Pressure containment: quarantine may shed deterministically under hard caps.
        this.stats.ignoredCount++;
        return {
          status: "ignored",
          signature,
        };
      }

      // Forward quarantined evidence to HoundPool for async processing.
      // This is the canonical wiring point: evidence is still typed as Evidence
      // here (not yet narrowed to EvidenceHandle), enabling direct activation.
      this.houndPool?.activate(evidence);

      // Emit observability events - fire-and-forget, must not throw
      const qStats = this.quarantine.stats;
      this.runTelemetryHook(() => {
        this.notifications?.emit("threat.detected", {
          scentId: scent.id,
          category: threat.category,
          severity: threat.severity,
          source: scent.source,
        });
      });
      this.runTelemetryHook(() => {
        this.notifications?.emit("evidence.quarantined", {
          signature,
          severity: threat.severity,
          sizeBytes: qStats.bytes,
        });
      });
      this.runTelemetryHook(() => {
        this.watcher?.updateQuarantine(
          qStats.count,
          qStats.bytes,
          this.quarantine.maxBytes,
        );
      });

      // Success
      this.stats.quarantinedCount++;
      return {
        status: "quarantined",
        handle: this.createRuntimeEvidenceHandle(evidence),
      };
    } catch (error: unknown) {
      this.stats.errorCount++;

      const reason =
        error instanceof Error
          ? error.message
          : "Unknown error during intercept";

      return {
        status: "error",
        error: Errors.interceptFailed(reason, { scentId: scent.id }),
      };
    }
  }

  /**
   * Get current coordination health (RFC-0009).
   *
   * SECURITY: Provider contract violations and health errors always degrade
   * to local-compatible mode (fail-open), while emitting warning-level
   * enforcement events for observability.
   */
  getCoordinationHealth(): CoordinationHealth {
    const provider = this.config.coordinationProvider as
      | Partial<CoordinationProvider>
      | undefined;
    if (!provider) {
      this.trackCoordinationFallbackTransition(null);
      return {
        mode: "local",
        lastSyncAt: null,
        syncLagMs: null,
        provider: "local",
      };
    }

    const providerId = this.resolveProviderId(provider);

    if (typeof provider.health !== "function") {
      this.trackCoordinationFallbackTransition(`invalid_contract:${providerId}`);
      this.emitCoordinationWarning(
        "invalid_contract",
        providerId,
        Errors.coordinationContractInvalid(providerId, "health() is required"),
      );
      return this.toDegradedHealth(providerId);
    }

    try {
      const healthCandidate = provider.health() as unknown;
      if (!this.isValidCoordinationHealth(healthCandidate)) {
        this.trackCoordinationFallbackTransition(`invalid_contract:${providerId}`);
        this.emitCoordinationWarning(
          "invalid_contract",
          providerId,
          Errors.coordinationContractInvalid(
            providerId,
            "health() returned invalid payload",
          ),
        );
        return this.toDegradedHealth(providerId);
      }

      const health = healthCandidate;
      if (health.mode === "degraded") {
        this.trackCoordinationFallbackTransition(`degraded:${providerId}`);
      } else {
        this.trackCoordinationFallbackTransition(null);
      }

      return {
        mode: health.mode,
        lastSyncAt: health.lastSyncAt,
        syncLagMs: health.syncLagMs,
        provider: health.provider,
      };
    } catch (error: unknown) {
      this.trackCoordinationFallbackTransition(`health_failure:${providerId}`);
      this.emitCoordinationWarning("health_failure", providerId, error);
      return this.toDegradedHealth(providerId);
    }
  }

  /**
   * Get current agent statistics.
   */
  getStats(): Readonly<AgentStats> {
    return { ...this.stats };
  }

  private createRuntimeEvidenceHandle(evidence: {
    readonly size: number;
    readonly hash: string;
    readonly signature: string;
    readonly captured: number;
    readonly severity: RuntimeEvidenceHandle["severity"];
    readonly disposed: boolean;
    readonly source: RuntimeEvidenceHandle["source"];
  }): RuntimeEvidenceHandle {
    const signature = evidence.signature;
    const agent = this;

    const handle = {} as RuntimeEvidenceHandle;

    Object.defineProperties(handle, {
      membrane: {
        value: "metadata_only" as const,
        enumerable: true,
      },
      size: {
        get: (): number => evidence.size,
        enumerable: true,
      },
      hash: {
        get: (): string => evidence.hash,
        enumerable: true,
      },
      signature: {
        get: (): string => evidence.signature,
        enumerable: true,
      },
      captured: {
        get: (): number => evidence.captured,
        enumerable: true,
      },
      severity: {
        get: (): RuntimeEvidenceHandle["severity"] => evidence.severity,
        enumerable: true,
      },
      disposed: {
        get: (): boolean => evidence.disposed,
        enumerable: true,
      },
      source: {
        get: (): RuntimeEvidenceHandle["source"] => {
          const src = evidence.source;
          if (src === null || typeof src !== "object") {
            return src;
          }
          const cloned = structuredClone(src as unknown as object);
          return Object.freeze(cloned) as RuntimeEvidenceHandle["source"];
        },
        enumerable: true,
      },
      bytes: {
        get: (): never => agent.rejectRuntimePayloadEgress("bytes", signature),
        enumerable: false,
      },
      transfer: {
        value: (): never =>
          agent.rejectRuntimePayloadEgress("transfer", signature),
        enumerable: false,
      },
      neutralize: {
        value: (_previousHash: string): never =>
          agent.rejectRuntimePayloadEgress("neutralize", signature),
        enumerable: false,
      },
      evacuate: {
        value: (_destination: string): never =>
          agent.rejectRuntimePayloadEgress("evacuate", signature),
        enumerable: false,
      },
    });

    return Object.freeze(handle);
  }

  private rejectRuntimePayloadEgress(
    operation: "bytes" | "transfer" | "neutralize" | "evacuate",
    signature: string,
  ): never {
    this.stats.membraneRejectionCount++;

    this.runTelemetryHook(() => {
      this.notifications?.emit("system.panic", {
        level: "warning",
        reason: SYSTEM_PANIC_REASONS.MEMBRANE_PAYLOAD_EGRESS_BLOCKED,
        context: {
          operation,
          signature,
          code: "RUNTIME_MEMBRANE_VIOLATION",
        },
      });
    });

    throw Errors.runtimeMembraneViolation(operation);
  }
  private resolveProviderId(provider: Partial<CoordinationProvider>): string {
    const id = provider.providerId;
    if (typeof id === "string" && id.length > 0) {
      return id;
    }
    return "unknown-provider";
  }

  private toDegradedHealth(providerId: string): CoordinationHealth {
    return {
      mode: "degraded",
      lastSyncAt: null,
      syncLagMs: null,
      provider: providerId,
    };
  }

  private emitCoordinationWarning(
    reason: "invalid_contract" | "health_failure",
    providerId: string,
    error?: unknown,
  ): void {
    const dedupeKey = `${reason}:${providerId}`;
    if (this.emittedCoordinationWarnings.has(dedupeKey)) {
      return;
    }

    this.emittedCoordinationWarnings.add(dedupeKey);
    this.stats.coordinationWarningCount++;

    this.runTelemetryHook(() => {
      this.notifications?.emit("system.panic", {
        level: "warning",
        reason:
          reason === "invalid_contract"
            ? SYSTEM_PANIC_REASONS.COORDINATION_INVALID_CONTRACT
            : SYSTEM_PANIC_REASONS.COORDINATION_HEALTH_FAILURE,
        context: {
          providerId,
          error: this.getErrorMessage(error),
        },
      });
    });
  }

  private runTelemetryHook(hook: () => void): void {
    try {
      hook();
    } catch {
      // Telemetry hooks are best-effort and must never change runtime outcomes.
    }
  }

  private trackCoordinationFallbackTransition(nextKey: string | null): void {
    if (nextKey === null) {
      this.lastCoordinationFallbackKey = null;
      return;
    }

    if (this.lastCoordinationFallbackKey !== nextKey) {
      this.stats.coordinationFallbackCount++;
      this.lastCoordinationFallbackKey = nextKey;
    }
  }

  private getErrorMessage(error: unknown): string | undefined {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error !== "object" || error === null || !("message" in error)) {
      return undefined;
    }

    const { message } = error as { message?: unknown };
    if (typeof message !== "string" || message.length === 0) {
      return undefined;
    }

    return message;
  }

  private isValidCoordinationHealth(
    value: unknown,
  ): value is CoordinationHealth {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    const health = value as Partial<CoordinationHealth>;
    if (!this.isValidCoordinationMode(health.mode)) {
      return false;
    }

    if (typeof health.provider !== "string" || health.provider.length === 0) {
      return false;
    }

    if (
      health.lastSyncAt !== null &&
      !this.isNonNegativeFiniteNumber(health.lastSyncAt)
    ) {
      return false;
    }

    if (
      health.syncLagMs !== null &&
      !this.isNonNegativeFiniteNumber(health.syncLagMs)
    ) {
      return false;
    }

    return true;
  }

  private isValidCoordinationMode(
    mode: unknown,
  ): mode is CoordinationHealth["mode"] {
    return mode === "local" || mode === "degraded" || mode === "synchronized";
  }

  private isNonNegativeFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
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
  evidenceFactory: IEvidenceFactory,
  houndPool?: IHoundPool,
  watcher?: IWatcher,
  notifications?: INotificationEmitter,
): IAgent {
  return new Agent(
    config,
    quarantine,
    rateLimiter,
    evidenceFactory,
    houndPool,
    watcher,
    notifications,
  );
}
