/**
 * Soak harness entry point.
 *
 * Starts the Express + Tracehound server, the traffic generator,
 * and the metrics collector. Handles SIGINT and SIGTERM for graceful shutdown.
 *
 * Usage:
 *   pnpm --filter "tracehound-soak-testing" dev          # build + run
 *   node infrastructure/soak/dist/main.js             # after build
 *
 * Environment variables:
 *   SOAK_PORT           TCP port for the soak server (default: 8099)
 *   SOAK_RPS            Target requests-per-second (default: 10)
 *   SOAK_INTERVAL       Metrics sample interval in ms (default: 5000)
 *   SOAK_AUDIT_INTERVAL AuditChain drain interval in ms (default: 10000)
 */

import { createAuditLogger } from './audit.js'
import { createMetricsCollector } from './metrics.js'
import { createSoakServer, resolveSoakSnapshotSecret } from './server.js'
import { createTrafficGenerator } from './traffic.js'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ─────────────────────────────────────────────────────────────────────────────
// Config from environment
// ─────────────────────────────────────────────────────────────────────────────

function readInt(key: string, fallback: number): number {
  const raw = process.env[key]
  if (raw === undefined || raw === '') return fallback
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const PORT = readInt('SOAK_PORT', 8_099)
const RPS = readInt('SOAK_RPS', 10)
const INTERVAL_MS = readInt('SOAK_INTERVAL', 5_000)
const AUDIT_INTERVAL_MS = readInt('SOAK_AUDIT_INTERVAL', 10_000)
const RELEASE_LABEL = process.env['TRACEHOUND_RELEASE_LABEL'] ?? 'local'

function resolveCommitSha(): string {
  const fromEnv = process.env['GITHUB_SHA']
  return typeof fromEnv === 'string' && fromEnv.length > 0 ? fromEnv : 'unknown'
}

function readPackageVersion(packageDir: string): string {
  const raw = JSON.parse(
    readFileSync(resolve(process.cwd(), packageDir, 'package.json'), 'utf8'),
  ) as {
    version?: string
  }
  return raw.version ?? 'unknown'
}

function writeReleaseMetadata(snapshotPath: string): void {
  const logsDir = resolve(process.cwd(), 'infrastructure', 'soak', 'logs')
  mkdirSync(logsDir, { recursive: true })
  writeFileSync(
    resolve(logsDir, 'release-metadata.json'),
    JSON.stringify(
      {
        release: RELEASE_LABEL,
        artifactSource: 'workspace',
        buildMode: 'tsc-first',
        commitSha: resolveCommitSha(),
        executedAt: new Date().toISOString(),
        snapshotPath,
        packages: {
          core: readPackageVersion('packages/core'),
          express: readPackageVersion('packages/express'),
        },
      },
      null,
      2,
    ),
    'utf8',
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

function banner(): void {
  const line = '─'.repeat(70)
  process.stdout.write(`\n${line}\n`)
  process.stdout.write(`  Tracehound Soak Harness\n`)
  process.stdout.write(
    `  Port: ${PORT}  RPS: ${RPS}  Metrics interval: ${INTERVAL_MS}ms  Audit interval: ${AUDIT_INTERVAL_MS}ms\n`,
  )
  process.stdout.write(`${line}\n\n`)
}

async function main(): Promise<void> {
  banner()

  // 1. Start server
  const server = await createSoakServer(PORT)

  const snapshotSecret = resolveSoakSnapshotSecret()
  const snapshotPath = server.snapshotPath
  writeReleaseMetadata(snapshotPath)

  process.stdout.write(`[soak] Server listening on http://127.0.0.1:${PORT}\n`)
  process.stdout.write(`[soak] Release label → ${RELEASE_LABEL}\n`)
  process.stdout.write(`[soak] Snapshot → ${snapshotPath}\n`)
  process.stdout.write(`[soak] To watch with the CLI (PowerShell):\n`)
  process.stdout.write(`[soak]   $env:TRACEHOUND_SYSTEM_SNAPSHOT_PATH='${snapshotPath}'\n`)
  process.stdout.write(`[soak]   $env:TRACEHOUND_SNAPSHOT_SECRET='${snapshotSecret}'\n`)
  process.stdout.write(`[soak]   pnpm --filter @tracehound/cli dev watch\n\n`)

  // 2. Traffic generator
  const traffic = createTrafficGenerator(PORT, RPS)

  // 3. Metrics collector
  const metrics = createMetricsCollector(server.tracehound, traffic.counters, INTERVAL_MS)
  metrics.start()

  // 4. Forensic audit logger
  const audit = createAuditLogger(server.tracehound, AUDIT_INTERVAL_MS)
  audit.start()

  // Give the server a moment to settle before sending traffic
  await new Promise<void>((resolve) => setTimeout(resolve, 500))
  process.stdout.write(`[soak] Traffic generator started (${RPS} req/s target)\n\n`)
  traffic.start()

  // ── Graceful shutdown ────────────────────────────────────────────────────

  let shuttingDown = false

  function shutdown(signal: string): void {
    if (shuttingDown) return
    shuttingDown = true

    process.stdout.write(`\n[soak] Received ${signal} — shutting down...\n`)

    // 1. Stop new traffic immediately
    traffic.stop()

    // 2. Final metrics sample is taken inside metrics.stop()
    metrics.stop()

    // 3. Final audit drain (flushes pending chain records, writes final events)
    audit.stop()

    // 4. Close HTTP server — stop accepting new connections
    server.httpServer.close(() => {
      // 5. Shut down Tracehound (hound pool, snapshot loop, scheduler)
      server.tracehound.shutdown()
      process.stdout.write('[soak] Clean shutdown complete.\n\n')
      process.exit(0)
    })

    // Force exit if server close takes too long
    setTimeout(() => {
      process.stderr.write('[soak] Forced exit after timeout.\n')
      process.exit(1)
    }, 10_000).unref()
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[soak] Fatal startup error: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
})
