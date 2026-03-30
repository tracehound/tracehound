import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface ReleaseMetadata {
  readonly release?: string
  readonly artifactSource?: string
  readonly buildMode?: string
}

interface SmokeMetricsRecord {
  readonly traffic?: {
    readonly total?: number
  }
  readonly agent?: {
    readonly total?: number
  }
}

interface SmokeSummary {
  readonly release: string
  readonly durationMs: number
  readonly metadataPath: string
  readonly metricsPath: string
  readonly stdoutPath: string
  readonly stderrPath: string
  readonly childExit: {
    readonly code: number | null
    readonly signal: NodeJS.Signals | null
  }
  readonly assertions: {
    readonly metadataVerified: boolean
    readonly metricsVerified: boolean
  }
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..', '..', '..')
const SOAK_ROOT = resolve(REPO_ROOT, 'infrastructure', 'soak')
const LOGS_DIR = resolve(SOAK_ROOT, 'logs')
const RUN_DURATION_MS = 6_000
const SHUTDOWN_TIMEOUT_MS = 4_000
const RELEASE_LABEL = `smoke-${new Date().toISOString().replace(/[:.]/g, '-')}`
const METADATA_PATH = resolve(LOGS_DIR, 'release-metadata.json')
const METRICS_PATH = resolve(LOGS_DIR, 'metrics.jsonl')
const SUMMARY_PATH = resolve(LOGS_DIR, 'smoke-summary.json')
const TEMP_DIR = join(tmpdir(), 'tracehound-soak-smoke')
const STDOUT_PATH = join(TEMP_DIR, `${RELEASE_LABEL}.stdout.log`)
const STDERR_PATH = join(TEMP_DIR, `${RELEASE_LABEL}.stderr.log`)

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function readLatestMetrics(path: string): SmokeMetricsRecord | null {
  const text = readFileSync(path, 'utf8').trim()
  if (text.length === 0) {
    return null
  }

  const lines = text.split(/\r?\n/).filter((line) => line.length > 0)
  if (lines.length === 0) {
    return null
  }

  return JSON.parse(lines[lines.length - 1]!) as SmokeMetricsRecord
}

async function stopChild(child: ReturnType<typeof spawn>): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return await new Promise((resolvePromise, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (!settled) {
        child.kill('SIGKILL')
      }
    }, SHUTDOWN_TIMEOUT_MS)

    child.once('error', (error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      reject(error)
    })

    child.once('exit', (code, signal) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      resolvePromise({ code, signal })
    })

    child.kill('SIGINT')
  })
}

async function main(): Promise<void> {
  mkdirSync(LOGS_DIR, { recursive: true })
  mkdirSync(TEMP_DIR, { recursive: true })

  const metadataBefore = existsSync(METADATA_PATH) ? statSync(METADATA_PATH).mtimeMs : undefined
  const metricsBefore = existsSync(METRICS_PATH) ? statSync(METRICS_PATH).mtimeMs : undefined
  const stdoutFd = openSync(STDOUT_PATH, 'w')
  const stderrFd = openSync(STDERR_PATH, 'w')

  const child = spawn(process.execPath, [resolve(SOAK_ROOT, 'dist', 'main.js')], {
    cwd: SOAK_ROOT,
    env: {
      ...process.env,
      SOAK_INTERVAL: '1000',
      SOAK_RPS: '3',
      SOAK_PORT: '8111',
      TRACEHOUND_RELEASE_LABEL: RELEASE_LABEL,
    },
    stdio: ['ignore', stdoutFd, stderrFd],
  })

  await sleep(RUN_DURATION_MS)
  const exit = await stopChild(child)
  closeSync(stdoutFd)
  closeSync(stderrFd)

  const metadataStat = existsSync(METADATA_PATH) ? statSync(METADATA_PATH) : undefined
  const metricsStat = existsSync(METRICS_PATH) ? statSync(METRICS_PATH) : undefined

  assert(metadataStat !== undefined, 'release metadata was not written')
  assert(metricsStat !== undefined, 'metrics log was not written')
  if (metadataStat === undefined || metricsStat === undefined) {
    throw new Error('soak smoke artifacts are missing after execution')
  }
  assert(
    metadataBefore === undefined || metadataStat.mtimeMs >= metadataBefore,
    'release metadata timestamp did not advance',
  )
  assert(
    metricsBefore === undefined || metricsStat.mtimeMs >= metricsBefore,
    'metrics log timestamp did not advance',
  )

  const metadata = readJson<ReleaseMetadata>(METADATA_PATH)
  assert(metadata.release === RELEASE_LABEL, 'release metadata label mismatch')
  assert(metadata.artifactSource === 'workspace', 'unexpected artifact source in release metadata')
  assert(metadata.buildMode === 'tsc-first', 'unexpected build mode in release metadata')

  const metrics = readLatestMetrics(METRICS_PATH)
  assert(metrics !== null, 'metrics log is empty')
  assert(
    (metrics!.traffic?.total ?? 0) > 0 || (metrics!.agent?.total ?? 0) > 0,
    'soak smoke did not record any traffic',
  )

  const summary: SmokeSummary = {
    release: RELEASE_LABEL,
    durationMs: RUN_DURATION_MS,
    metadataPath: METADATA_PATH,
    metricsPath: METRICS_PATH,
    stdoutPath: STDOUT_PATH,
    stderrPath: STDERR_PATH,
    childExit: exit,
    assertions: {
      metadataVerified: true,
      metricsVerified: true,
    },
  }

  writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2), 'utf8')
  process.stdout.write(JSON.stringify(summary, null, 2))
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[soak-smoke] ${message}\n`)
  process.exitCode = 1
})
