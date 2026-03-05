/**
 * System snapshot export/read utilities.
 *
 * SECURITY:
 * - Snapshot payload is HMAC-SHA256 signed.
 * - Signature is verified with constant-time comparison.
 * - Writes are atomic (.tmp + rename).
 * - POSIX permissions are set to owner-only best-effort (0600).
 */

import { createHmac } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentStats } from "../core/agent.js";
import type { HoundPoolStats } from "../core/hound-pool.js";
import type { QuarantineStats } from "../core/quarantine.js";
import type { RateLimiterStats } from "../core/rate-limiter.js";
import type { ITracehound } from "../core/tracehound.js";
import type { WatcherSnapshot } from "../core/watcher.js";
import { Errors } from "../types/errors.js";
import { constantTimeEqual } from "./compare.js";

export type SystemHealth = "healthy" | "degraded" | "critical";

export interface SystemSnapshot {
  generatedAt: number;
  systemHealth: SystemHealth;
  agent: Readonly<AgentStats>;
  quarantine: Readonly<QuarantineStats>;
  quarantineMaxBytes: number;
  watcher: Readonly<WatcherSnapshot>;
  houndPool: Readonly<HoundPoolStats>;
  rateLimiter: Readonly<RateLimiterStats>;
}

interface SignedSystemSnapshot {
  version: 1;
  algorithm: "HMAC-SHA256";
  payload: SystemSnapshot;
  signature: string;
}

export type SnapshotReadResult =
  | { ok: true; snapshot: SystemSnapshot }
  | {
      ok: false;
      reason:
        | "NO_INSTANCE"
        | "INTEGRITY_VIOLATION"
        | "INVALID_FORMAT"
        | "IO_ERROR";
    };

const DEFAULT_SNAPSHOT_PATH = join(
  tmpdir(),
  "tracehound",
  "system-snapshot.json",
);
let windowsAclWarningEmitted = false;

/**
 * Resolve snapshot path from explicit path, env, or default.
 */
export function resolveSystemSnapshotPath(pathOverride?: string): string {
  if (typeof pathOverride === "string" && pathOverride.length > 0) {
    return pathOverride;
  }

  const fromEnv = process.env["TRACEHOUND_SYSTEM_SNAPSHOT_PATH"];
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    return fromEnv;
  }

  return DEFAULT_SNAPSHOT_PATH;
}

/**
 * Resolve snapshot secret from explicit value or env.
 */
export function resolveSystemSnapshotSecret(
  secretOverride?: string,
): string | null {
  if (typeof secretOverride === "string" && secretOverride.length > 0) {
    return secretOverride;
  }

  const fromEnv = process.env["TRACEHOUND_SNAPSHOT_SECRET"];
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    return fromEnv;
  }

  return null;
}

/**
 * Export immutable runtime snapshot from a live Tracehound instance.
 */
export function exportSystemSnapshot(tracehound: ITracehound): SystemSnapshot {
  const watcher = tracehound.watcher.snapshot();
  const pool = tracehound.houndPool.stats;

  const systemHealth: SystemHealth = deriveSystemHealth(watcher, pool);

  return Object.freeze({
    generatedAt: Date.now(),
    systemHealth,
    agent: tracehound.agent.getStats(),
    quarantine: tracehound.quarantine.stats,
    quarantineMaxBytes: tracehound.quarantine.maxBytes,
    watcher,
    houndPool: pool,
    rateLimiter: tracehound.rateLimiter.stats,
  });
}

/**
 * Write signed snapshot to disk atomically.
 */
export function writeSystemSnapshotToDisk(
  snapshot: SystemSnapshot,
  path: string,
  secret: string,
): void {
  if (secret.length === 0) {
    throw Errors.snapshotSecretMissing();
  }

  const payloadText = JSON.stringify(snapshot);
  const signed: SignedSystemSnapshot = {
    version: 1,
    algorithm: "HMAC-SHA256",
    payload: snapshot,
    signature: signPayload(payloadText, secret),
  };
  const signedText = JSON.stringify(signed);

  const parent = dirname(path);
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;

  try {
    mkdirSync(parent, { recursive: true });
    writeFileSync(tmpPath, signedText, {
      encoding: "utf8",
      mode: 0o600,
      flag: "w",
    });
    replaceSnapshotFile(tmpPath, path);

    if (process.platform !== "win32") {
      try {
        chmodSync(path, 0o600);
      } catch {
        // Best-effort only. Not fatal for fail-open semantics.
      }
    } else if (!windowsAclWarningEmitted) {
      windowsAclWarningEmitted = true;
      process.emitWarning(
        "Tracehound snapshot file ACL hardening is best-effort on Windows. Configure ACLs externally for strict isolation.",
      );
    }
  } catch (error: unknown) {
    try {
      if (existsSync(tmpPath)) {
        unlinkSync(tmpPath);
      }
    } catch {
      // Ignore temp cleanup errors.
    }
    const reason = error instanceof Error ? error.message : "unknown";
    throw Errors.snapshotWriteFailed(reason);
  }
}

/**
 * Read and verify snapshot from disk.
 */
export function readSystemSnapshotFromDisk(
  path: string,
  secret: string,
): SnapshotReadResult {
  if (!existsSync(path)) {
    return { ok: false, reason: "NO_INSTANCE" };
  }

  if (secret.length === 0) {
    return { ok: false, reason: "INTEGRITY_VIOLATION" };
  }

  try {
    const text = readFileSync(path, "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (!isSignedSnapshot(parsed)) {
      return { ok: false, reason: "INVALID_FORMAT" };
    }

    const payloadText = JSON.stringify(parsed.payload);
    const expected = signPayload(payloadText, secret);
    if (!constantTimeEqual(expected, parsed.signature)) {
      return { ok: false, reason: "INTEGRITY_VIOLATION" };
    }

    return { ok: true, snapshot: parsed.payload };
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error) {
      return { ok: false, reason: "IO_ERROR" };
    }
    return { ok: false, reason: "INVALID_FORMAT" };
  }
}

function signPayload(payloadText: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadText).digest("hex");
}

function replaceSnapshotFile(tmpPath: string, path: string): void {
  if (!existsSync(path)) {
    renameSync(tmpPath, path);
    return;
  }

  if (process.platform !== "win32") {
    // POSIX rename provides atomic replace semantics when destination exists.
    renameSync(tmpPath, path);
    return;
  }

  const backupPath = `${path}.bak-${process.pid}-${Date.now()}`;
  renameSync(path, backupPath);

  let committed = false;
  try {
    renameSync(tmpPath, path);
    committed = true;
  } finally {
    if (committed) {
      try {
        if (existsSync(backupPath)) {
          unlinkSync(backupPath);
        }
      } catch {
        // Best-effort cleanup only.
      }
      return;
    }

    try {
      if (existsSync(backupPath) && !existsSync(path)) {
        renameSync(backupPath, path);
      }
    } catch {
      // Best-effort rollback only.
    }
  }
}

function deriveSystemHealth(
  watcher: Readonly<WatcherSnapshot>,
  pool: Readonly<HoundPoolStats>,
): SystemHealth {
  if (watcher.overloaded) {
    return "critical";
  }

  if (pool.totalProcesses > 0 && pool.activeProcesses >= pool.totalProcesses) {
    return "critical";
  }

  if (watcher.alertsInWindow > 0) {
    return "degraded";
  }

  return "healthy";
}

function isSignedSnapshot(value: unknown): value is SignedSystemSnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<SignedSystemSnapshot>;
  if (candidate.version !== 1) {
    return false;
  }
  if (candidate.algorithm !== "HMAC-SHA256") {
    return false;
  }
  if (
    typeof candidate.signature !== "string" ||
    candidate.signature.length === 0
  ) {
    return false;
  }
  if (!isSystemSnapshot(candidate.payload)) {
    return false;
  }

  return true;
}

function isSystemSnapshot(value: unknown): value is SystemSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  const snapshot = value as {
    generatedAt?: unknown;
    systemHealth?: unknown;
    quarantineMaxBytes?: unknown;
    agent?: unknown;
    quarantine?: unknown;
    watcher?: unknown;
    houndPool?: unknown;
    rateLimiter?: unknown;
  };

  if (!isNonNegativeFiniteNumber(snapshot.generatedAt)) {
    return false;
  }
  if (!isSystemHealth(snapshot.systemHealth)) {
    return false;
  }
  if (!isNonNegativeInteger(snapshot.quarantineMaxBytes)) {
    return false;
  }

  if (!isAgentStats(snapshot.agent)) {
    return false;
  }
  if (!isQuarantineStats(snapshot.quarantine)) {
    return false;
  }
  if (!isWatcherSnapshot(snapshot.watcher)) {
    return false;
  }
  if (!isHoundPoolStats(snapshot.houndPool)) {
    return false;
  }
  if (!isRateLimiterStats(snapshot.rateLimiter)) {
    return false;
  }

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSystemHealth(value: unknown): value is SystemHealth {
  return value === "healthy" || value === "degraded" || value === "critical";
}

function isAgentStats(value: unknown): value is AgentStats {
  if (!isRecord(value)) {
    return false;
  }

  const stats = value as {
    totalIntercepts?: unknown;
    cleanCount?: unknown;
    rateLimitedCount?: unknown;
    validationFailures?: unknown;
    ignoredCount?: unknown;
    quarantinedCount?: unknown;
    errorCount?: unknown;
    coordinationFallbackCount?: unknown;
    coordinationWarningCount?: unknown;
    membraneRejectionCount?: unknown;
  };

  return (
    isNonNegativeInteger(stats.totalIntercepts) &&
    isNonNegativeInteger(stats.cleanCount) &&
    isNonNegativeInteger(stats.rateLimitedCount) &&
    isNonNegativeInteger(stats.validationFailures) &&
    isNonNegativeInteger(stats.ignoredCount) &&
    isNonNegativeInteger(stats.quarantinedCount) &&
    isNonNegativeInteger(stats.errorCount) &&
    isNonNegativeInteger(stats.coordinationFallbackCount) &&
    isNonNegativeInteger(stats.coordinationWarningCount) &&
    isNonNegativeInteger(stats.membraneRejectionCount)
  );
}

function isQuarantineStats(value: unknown): value is QuarantineStats {
  if (!isRecord(value)) {
    return false;
  }

  const stats = value as {
    count?: unknown;
    bytes?: unknown;
    droppedCount?: unknown;
    droppedBytes?: unknown;
    bySeverity?: unknown;
  };

  return (
    isNonNegativeInteger(stats.count) &&
    isNonNegativeInteger(stats.bytes) &&
    isNonNegativeInteger(stats.droppedCount) &&
    isNonNegativeInteger(stats.droppedBytes) &&
    isSeverityCounters(stats.bySeverity)
  );
}

function isWatcherSnapshot(value: unknown): value is WatcherSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  const snapshot = value as {
    uptimeMs?: unknown;
    threats?: unknown;
    quarantine?: unknown;
    totalAlerts?: unknown;
    alertsInWindow?: unknown;
    lastAlert?: unknown;
    overloaded?: unknown;
    snapshotTime?: unknown;
  };

  if (!isRecord(snapshot.threats) || !isRecord(snapshot.quarantine)) {
    return false;
  }

  const threats = snapshot.threats as {
    total?: unknown;
    byCategory?: unknown;
    bySeverity?: unknown;
  };
  const quarantine = snapshot.quarantine as {
    count?: unknown;
    bytes?: unknown;
    capacityPercent?: unknown;
  };

  return (
    isNonNegativeInteger(snapshot.uptimeMs) &&
    isNonNegativeInteger(threats.total) &&
    isNumericRecord(threats.byCategory) &&
    isSeverityCounters(threats.bySeverity) &&
    isNonNegativeInteger(quarantine.count) &&
    isNonNegativeInteger(quarantine.bytes) &&
    isNonNegativeFiniteNumber(quarantine.capacityPercent) &&
    isNonNegativeInteger(snapshot.totalAlerts) &&
    isNonNegativeInteger(snapshot.alertsInWindow) &&
    isAlertOrNull(snapshot.lastAlert) &&
    typeof snapshot.overloaded === "boolean" &&
    isNonNegativeFiniteNumber(snapshot.snapshotTime)
  );
}

function isAlertOrNull(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }

  const alert = value as {
    id?: unknown;
    type?: unknown;
    severity?: unknown;
    message?: unknown;
    timestamp?: unknown;
    context?: unknown;
  };

  if (
    typeof alert.id !== "string" ||
    alert.id.length === 0 ||
    !isAlertType(alert.type) ||
    !isAlertSeverity(alert.severity) ||
    typeof alert.message !== "string" ||
    alert.message.length === 0 ||
    !isNonNegativeFiniteNumber(alert.timestamp)
  ) {
    return false;
  }

  if (alert.context !== undefined && !isRecord(alert.context)) {
    return false;
  }

  return true;
}

function isAlertType(value: unknown): boolean {
  return (
    value === "threat_detected" ||
    value === "evidence_neutralized" ||
    value === "quarantine_full" ||
    value === "quarantine_high" ||
    value === "rate_limit_exceeded" ||
    value === "hound_timeout" ||
    value === "system_overload"
  );
}

function isAlertSeverity(value: unknown): boolean {
  return value === "info" || value === "warning" || value === "critical";
}

function isHoundPoolStats(value: unknown): value is HoundPoolStats {
  if (!isRecord(value)) {
    return false;
  }

  const stats = value as {
    activeProcesses?: unknown;
    totalProcesses?: unknown;
    totalActivations?: unknown;
    totalTimeouts?: unknown;
    totalErrors?: unknown;
    avgProcessingMs?: unknown;
    isolationTelemetry?: unknown;
  };

  return (
    isNonNegativeInteger(stats.activeProcesses) &&
    isNonNegativeInteger(stats.totalProcesses) &&
    isNonNegativeInteger(stats.totalActivations) &&
    isNonNegativeInteger(stats.totalTimeouts) &&
    isNonNegativeInteger(stats.totalErrors) &&
    isNonNegativeFiniteNumber(stats.avgProcessingMs) &&
    (stats.isolationTelemetry === undefined ||
      isProcessIsolationTelemetry(stats.isolationTelemetry))
  );
}

function isProcessIsolationTelemetry(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const telemetry = value as {
    constraints?: unknown;
    capabilities?: unknown;
    environmentAllowlistSize?: unknown;
  };

  return (
    isProcessConstraints(telemetry.constraints) &&
    isProcessIsolationCapabilities(telemetry.capabilities) &&
    isNonNegativeInteger(telemetry.environmentAllowlistSize)
  );
}

function isProcessConstraints(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const constraints = value as {
    maxMemoryMB?: unknown;
    networkAccess?: unknown;
    fileSystemWrite?: unknown;
    childSpawn?: unknown;
  };

  const hasValidMemory =
    constraints.maxMemoryMB === undefined ||
    isNonNegativeInteger(constraints.maxMemoryMB);

  return (
    hasValidMemory &&
    constraints.networkAccess === false &&
    constraints.fileSystemWrite === false &&
    constraints.childSpawn === false
  );
}

function isProcessIsolationCapabilities(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const capabilities = value as {
    platform?: unknown;
    memoryLimit?: unknown;
    processTermination?: unknown;
    environmentIsolation?: unknown;
    networkAccess?: unknown;
    fileSystemWrite?: unknown;
    childSpawn?: unknown;
  };

  return (
    isProcessPlatform(capabilities.platform) &&
    isIsolationEnforcementLevel(capabilities.memoryLimit) &&
    isIsolationEnforcementLevel(capabilities.processTermination) &&
    capabilities.environmentIsolation === "allowlist" &&
    isIsolationEnforcementLevel(capabilities.networkAccess) &&
    isIsolationEnforcementLevel(capabilities.fileSystemWrite) &&
    isIsolationEnforcementLevel(capabilities.childSpawn)
  );
}

function isProcessPlatform(value: unknown): boolean {
  return (
    value === "aix" ||
    value === "darwin" ||
    value === "freebsd" ||
    value === "linux" ||
    value === "openbsd" ||
    value === "sunos" ||
    value === "win32" ||
    value === "android" ||
    value === "haiku" ||
    value === "cygwin" ||
    value === "netbsd" ||
    value === "unknown"
  );
}

function isIsolationEnforcementLevel(value: unknown): boolean {
  return (
    value === "enforced" || value === "best_effort" || value === "declarative"
  );
}

function isRateLimiterStats(value: unknown): value is RateLimiterStats {
  if (!isRecord(value)) {
    return false;
  }

  const stats = value as {
    sources?: unknown;
    blocked?: unknown;
    totalChecks?: unknown;
    totalRejections?: unknown;
    totalEvictions?: unknown;
  };

  return (
    isNonNegativeInteger(stats.sources) &&
    isNonNegativeInteger(stats.blocked) &&
    isNonNegativeInteger(stats.totalChecks) &&
    isNonNegativeInteger(stats.totalRejections) &&
    isNonNegativeInteger(stats.totalEvictions)
  );
}

function isSeverityCounters(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const counters = value as {
    low?: unknown;
    medium?: unknown;
    high?: unknown;
    critical?: unknown;
  };

  return (
    isNonNegativeInteger(counters.low) &&
    isNonNegativeInteger(counters.medium) &&
    isNonNegativeInteger(counters.high) &&
    isNonNegativeInteger(counters.critical)
  );
}

function isNumericRecord(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  for (const entryValue of Object.values(value)) {
    if (!isNonNegativeInteger(entryValue)) {
      return false;
    }
  }

  return true;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return isNonNegativeFiniteNumber(value) && Number.isInteger(value);
}
