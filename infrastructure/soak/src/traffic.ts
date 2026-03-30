/**
 * Traffic generator for the soak harness.
 *
 * Sends a realistic mixed-profile request stream against the soak server:
 *   clean traffic (random routes, diverse source IPs)
 *   injection threats   (single POST /api/data, threat headers set)
 *   ddos threats        (single IP hammering /api/search)
 *   flood threats       (credential-stuffing pattern on /api/login)
 *   rate-limit probes   (same IP, burst of requests until 429)
 *
 * The generator explicitly avoids crypto-strength RNG (Math.random is fine
 * here — this is simulation logic, not forensic path code).
 */

import http from 'node:http'

// ─────────────────────────────────────────────────────────────────────────────
// IP Pool
// ─────────────────────────────────────────────────────────────────────────────

const CLEAN_IPS: readonly string[] = [
  '10.0.0.1',
  '10.0.0.2',
  '10.0.0.3',
  '10.0.0.4',
  '10.0.0.5',
  '10.0.1.1',
  '10.0.1.2',
  '10.0.1.3',
  '10.0.1.4',
  '10.0.1.5',
  '10.0.2.1',
  '10.0.2.2',
  '10.0.2.3',
  '10.0.2.4',
  '10.0.2.5',
  '10.0.3.1',
  '10.0.3.2',
  '10.0.3.3',
  '10.0.3.4',
  '10.0.3.5',
]

// Realistic user IPs — 172.16.x.x subnet, distinct from synthetic clean traffic
const REALISTIC_USER_IPS: readonly string[] = [
  '172.16.0.1',
  '172.16.0.2',
  '172.16.0.3',
  '172.16.0.4',
  '172.16.0.5',
  '172.16.1.1',
  '172.16.1.2',
  '172.16.1.3',
  '172.16.1.4',
  '172.16.1.5',
  '172.16.2.1',
  '172.16.2.2',
  '172.16.2.3',
  '172.16.2.4',
  '172.16.2.5',
  '172.16.3.1',
  '172.16.3.2',
  '172.16.3.3',
  '172.16.3.4',
  '172.16.3.5',
  '172.16.4.1',
  '172.16.4.2',
  '172.16.4.3',
  '172.16.4.4',
  '172.16.4.5',
  '172.16.5.1',
  '172.16.5.2',
  '172.16.5.3',
  '172.16.5.4',
  '172.16.5.5',
]

const REALISTIC_USER_AGENTS: readonly string[] = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Safari/605.1.15',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.119 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
]

const REALISTIC_SEARCH_QUERIES: readonly string[] = [
  'running shoes',
  'laptop deals',
  'how to reset password',
  'account settings',
  'order history',
  'return policy',
  'product reviews',
  'shipping status',
  'contact support',
  'winter jacket sale',
  'invoice download',
  'profile update',
]

const REALISTIC_USERNAMES: readonly string[] = [
  'john.doe',
  'alice_smith',
  'bob.jones',
  'carol.white',
  'dave_brown',
  'emma.taylor',
  'frank_miller',
  'grace.wilson',
  'henry.moore',
  'isabella.clark',
  'james.lee',
  'karen.zhang',
  'lucas.martin',
  'mia.garcia',
  'noah.johnson',
]

const REALISTIC_PAGES: readonly string[] = [
  '/',
  '/products',
  '/cart',
  '/checkout',
  '/account',
  '/orders',
]
const REALISTIC_EVENTS: readonly string[] = [
  'page_view',
  'button_click',
  'form_submit',
  'scroll_depth',
  'session_start',
]

const ATTACK_IP_INJECTION = '192.168.100.10'
const ATTACK_IP_DDOS = '192.168.100.20'
const ATTACK_IP_FLOOD = '192.168.100.30'
const RATE_PROBE_IP = '192.168.100.40'
/** Burst lane: rapid-fire malware requests from one IP to saturate rate limiter + quarantine */
const ATTACK_IP_BURST = '192.168.100.50'
/** Oversized lane: body > 512 kb to exercise the payload_too_large intercept path */
const ATTACK_IP_OVERSIZED = '192.168.100.60'

/** Size of a single burst salvo (requests fired at once) */
const BURST_SALVO_SIZE = 25
/** Interval between burst salvos in ms */
const BURST_SALVO_INTERVAL_MS = 12_000
/** Size of oversized body (bytes) — must be > maxPayloadSize (512 000) and < 600 kb */
const OVERSIZED_BODY_BYTES = 530_000

// ─────────────────────────────────────────────────────────────────────────────
// Request primitives
// ─────────────────────────────────────────────────────────────────────────────

interface RequestSpec {
  method: string
  path: string
  headers?: Record<string, string>
  body?: Record<string, unknown>
  sourceIp?: string
}

interface ResponseResult {
  status: number
  durationMs: number
  traceId: string | null
}

function sendRequest(port: number, spec: RequestSpec): Promise<ResponseResult> {
  return new Promise((resolve, reject) => {
    const start = Date.now()

    const bodyStr =
      spec.body !== undefined && spec.method !== 'GET' ? JSON.stringify(spec.body) : undefined

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'tracehound-soak/0.1',
      // Forward test IP via X-Forwarded-For so Express sees the right
      // source even though requests originate from loopback.
      ...(spec.sourceIp !== undefined ? { 'x-forwarded-for': spec.sourceIp } : {}),
      ...spec.headers,
    }

    if (bodyStr !== undefined) {
      headers['content-length'] = String(Buffer.byteLength(bodyStr))
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method: spec.method,
        path: spec.path,
        headers,
      },
      (res) => {
        res.resume() // discard body — we only care about status
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            durationMs: Date.now() - start,
            traceId:
              typeof res.headers['x-tracehound-trace-id'] === 'string'
                ? res.headers['x-tracehound-trace-id']
                : null,
          })
        })
      },
    )

    req.setTimeout(5_000, () => {
      req.destroy()
      reject(new Error('request timeout'))
    })

    req.on('error', reject)

    if (bodyStr !== undefined) {
      req.write(bodyStr)
    }
    req.end()
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Lane definitions
// ─────────────────────────────────────────────────────────────────────────────

function buildCleanSpec(): RequestSpec {
  const routes: ReadonlyArray<RequestSpec> = [
    { method: 'GET', path: '/health' },
    { method: 'GET', path: '/api/search?q=soak-test' },
    { method: 'POST', path: '/api/data', body: { event: 'page_view', ts: Date.now() } },
    { method: 'POST', path: '/api/login', body: { username: 'tester', password: 'secret' } },
  ]

  const ipIndex = Math.floor(Math.random() * CLEAN_IPS.length)
  const routeIndex = Math.floor(Math.random() * routes.length)

  return {
    ...(routes[routeIndex] as RequestSpec),
    sourceIp: CLEAN_IPS[ipIndex] as string,
  }
}

// Injection variants — varied payloads produce unique signatures so quarantine
// accumulates over time (realistic long-duration soak behaviour).
const INJECTION_VARIANTS: readonly string[] = [
  "' OR 1=1; DROP TABLE users; --",
  "' UNION SELECT * FROM credentials --",
  '<script>document.cookie</script>',
  '{{7*7}}',
  '${7*7}',
  '; cat /etc/passwd',
  '../../../etc/shadow',
  '\\x00\\x00\\x00\\x00 overflow',
]

function buildInjectionSpec(): RequestSpec {
  const variant = INJECTION_VARIANTS[
    Math.floor(Math.random() * INJECTION_VARIANTS.length)
  ] as string
  return {
    method: 'POST',
    path: '/api/data',
    headers: {
      'x-soak-threat-category': 'injection',
      'x-soak-threat-severity': 'high',
    },
    body: { payload: variant, ts: Date.now(), session: Math.floor(Math.random() * 1_000) },
    sourceIp: ATTACK_IP_INJECTION,
  }
}

function buildDdosSpec(): RequestSpec {
  return {
    method: 'GET',
    path: `/api/search?q=ddos-${Date.now()}-${Math.floor(Math.random() * 10_000)}`,
    headers: {
      'x-soak-threat-category': 'ddos',
      'x-soak-threat-severity': 'critical',
    },
    sourceIp: ATTACK_IP_DDOS,
  }
}

function buildFloodSpec(): RequestSpec {
  return {
    method: 'POST',
    path: '/api/login',
    headers: {
      'x-soak-threat-category': 'flood',
      'x-soak-threat-severity': 'medium',
    },
    body: {
      username: `user-${Math.floor(Math.random() * 500)}`,
      password: `pwd-${Math.floor(Math.random() * 100_000)}`,
      ts: Date.now(),
    },
    sourceIp: ATTACK_IP_FLOOD,
  }
}

function buildRateProbeSpec(): RequestSpec {
  return {
    method: 'GET',
    path: '/health',
    sourceIp: RATE_PROBE_IP,
  }
}

function buildRealisticUserSpec(): RequestSpec {
  const ip = REALISTIC_USER_IPS[Math.floor(Math.random() * REALISTIC_USER_IPS.length)] as string
  const ua = REALISTIC_USER_AGENTS[
    Math.floor(Math.random() * REALISTIC_USER_AGENTS.length)
  ] as string

  const roll = Math.random()
  let base: RequestSpec

  if (roll < 0.3) {
    // Search — most common user action
    const q = REALISTIC_SEARCH_QUERIES[
      Math.floor(Math.random() * REALISTIC_SEARCH_QUERIES.length)
    ] as string
    base = {
      method: 'GET',
      path: `/api/search?q=${encodeURIComponent(q)}&page=${Math.floor(Math.random() * 8) + 1}`,
    }
  } else if (roll < 0.55) {
    // Analytics / event tracking
    base = {
      method: 'POST',
      path: '/api/data',
      body: {
        event: REALISTIC_EVENTS[Math.floor(Math.random() * REALISTIC_EVENTS.length)],
        page: REALISTIC_PAGES[Math.floor(Math.random() * REALISTIC_PAGES.length)],
        sessionId: `sess-${Math.floor(Math.random() * 100_000)}`,
        ts: Date.now(),
      },
    }
  } else if (roll < 0.75) {
    // Login (legitimate credential entry)
    const username = REALISTIC_USERNAMES[
      Math.floor(Math.random() * REALISTIC_USERNAMES.length)
    ] as string
    base = {
      method: 'POST',
      path: '/api/login',
      body: { username, password: 'hunter2', rememberMe: Math.random() > 0.5 },
    }
  } else {
    // Health / status check (browser prefetch, uptime monitors)
    base = { method: 'GET', path: '/health' }
  }

  return {
    ...base,
    sourceIp: ip,
    headers: { 'user-agent': ua, ...base.headers },
  }
}

// Oversized body — just above Tracehound's maxPayloadSize limit (512 000 bytes).
// The express limit is raised to 600 kb so this reaches the middleware.
function buildOversizedSpec(): RequestSpec {
  // Pre-allocate the oversized string once per call — we vary a small suffix so
  // each request produces a distinct raw-body signature in the quarantine.
  const suffix = `-${Date.now()}-${Math.floor(Math.random() * 100_000)}`
  const data = 'O'.repeat(OVERSIZED_BODY_BYTES - suffix.length) + suffix
  return {
    method: 'POST',
    path: '/api/data',
    headers: {
      'x-soak-threat-category': 'malware',
      'x-soak-threat-severity': 'high',
    },
    body: { event: 'oversized', data },
    sourceIp: ATTACK_IP_OVERSIZED,
  }
}

// Burst lane — malware flood from a single IP; fired in salvos via burstTimerId.
function buildBurstSpec(): RequestSpec {
  return {
    method: 'POST',
    path: '/api/data',
    headers: {
      'x-soak-threat-category': 'malware',
      'x-soak-threat-severity': 'critical',
    },
    body: { scan: 'burst', tid: Math.floor(Math.random() * 100_000), ts: Date.now() },
    sourceIp: ATTACK_IP_BURST,
  }
}

type Lane =
  | 'clean'
  | 'injection'
  | 'ddos'
  | 'flood'
  | 'rate_probe'
  | 'oversized'
  | 'burst'
  | 'realistic_user'

function pickLane(): Lane {
  const r = Math.random()
  if (r < 0.55) return 'clean' // 55% — synthetic clean
  if (r < 0.7) return 'realistic_user' // 15% — real user simulation
  if (r < 0.82) return 'injection' // 12%
  if (r < 0.87) return 'ddos' //  5%
  if (r < 0.91) return 'flood' //  4%
  if (r < 0.95) return 'rate_probe' //  4%
  if (r < 0.98) return 'oversized' //  3%
  return 'burst' //  2%
}

function buildSpec(lane: Lane): RequestSpec {
  switch (lane) {
    case 'clean':
      return buildCleanSpec()
    case 'injection':
      return buildInjectionSpec()
    case 'ddos':
      return buildDdosSpec()
    case 'flood':
      return buildFloodSpec()
    case 'rate_probe':
      return buildRateProbeSpec()
    case 'oversized':
      return buildOversizedSpec()
    case 'burst':
      return buildBurstSpec()
    case 'realistic_user':
      return buildRealisticUserSpec()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface TrafficCounters {
  total: number
  sent: number
  byStatus: Map<number, number>
  errors: number
  byLane: Record<Lane, number>
  // False-positive tracking: responses from realistic_user lane that should never occur
  falsePositive429: number // rate-limited legitimate user
  falsePositive403: number // quarantined legitimate user (requires threat header — design invariant, should stay 0)
  traceHeadersOn403: number
  missingTraceHeadersOn403: number
}

export interface TrafficGenerator {
  readonly counters: TrafficCounters
  start(): void
  stop(): void
}

export function createTrafficGenerator(port: number, targetRps: number = 10): TrafficGenerator {
  if (!Number.isFinite(targetRps) || targetRps <= 0) {
    throw new RangeError(`targetRps must be a positive finite number, got: ${targetRps}`)
  }
  const counters: TrafficCounters = {
    total: 0,
    sent: 0,
    byStatus: new Map(),
    errors: 0,
    byLane: {
      clean: 0,
      injection: 0,
      ddos: 0,
      flood: 0,
      rate_probe: 0,
      oversized: 0,
      burst: 0,
      realistic_user: 0,
    },
    falsePositive429: 0,
    falsePositive403: 0,
    traceHeadersOn403: 0,
    missingTraceHeadersOn403: 0,
  }

  let timerId: NodeJS.Timeout | null = null
  let burstTimerId: NodeJS.Timeout | null = null

  const intervalMs = Math.max(1, Math.round(1_000 / targetRps))

  function fire(): void {
    const lane = pickLane()
    const spec = buildSpec(lane)

    counters.total++
    counters.byLane[lane]++

    sendRequest(port, spec)
      .then((result) => {
        counters.sent++
        const prev = counters.byStatus.get(result.status) ?? 0
        counters.byStatus.set(result.status, prev + 1)
        if (result.status === 403) {
          if (result.traceId !== null) {
            counters.traceHeadersOn403++
          } else {
            counters.missingTraceHeadersOn403++
          }
        }
        // Track false positives from the realistic_user lane
        if (lane === 'realistic_user') {
          if (result.status === 429) counters.falsePositive429++
          if (result.status === 403) counters.falsePositive403++
        }
      })
      .catch(() => {
        counters.errors++
      })
  }

  // Burst salvo — fires BURST_SALVO_SIZE oversized requests concurrently every
  // BURST_SALVO_INTERVAL_MS to create a clearly visible spike in the metrics.
  function fireBurstSalvo(): void {
    process.stdout.write(
      `[${new Date().toISOString()}] burst salvo: firing ${BURST_SALVO_SIZE} requests from ${ATTACK_IP_BURST}\n`,
    )
    for (let i = 0; i < BURST_SALVO_SIZE; i++) {
      const spec = buildBurstSpec()
      counters.total++
      counters.byLane.burst++
      sendRequest(port, spec)
        .then((result) => {
          counters.sent++
          const prev = counters.byStatus.get(result.status) ?? 0
          counters.byStatus.set(result.status, prev + 1)
          if (result.status === 403) {
            if (result.traceId !== null) {
              counters.traceHeadersOn403++
            } else {
              counters.missingTraceHeadersOn403++
            }
          }
        })
        .catch(() => {
          counters.errors++
        })
    }
  }

  return {
    counters,

    start(): void {
      if (timerId !== null) return
      timerId = setInterval(fire, intervalMs)
      burstTimerId = setInterval(fireBurstSalvo, BURST_SALVO_INTERVAL_MS)
    },

    stop(): void {
      if (timerId === null) return
      clearInterval(timerId)
      timerId = null
      if (burstTimerId !== null) {
        clearInterval(burstTimerId)
        burstTimerId = null
      }
    },
  }
}
