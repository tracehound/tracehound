# @tracehound/soak

Local Node.js soak test harness for validating Tracehound integration under realistic sustained load.

## What this is

A self-contained Express + Tracehound server paired with a built-in traffic generator and metrics collector. It runs indefinitely, sending a mixed-profile request stream against itself and logging runtime health samples every 5 seconds.

This is **not** a replacement for the full 15-day soak defined in the security harness runbook. It is a local integration smoke/soak tool for:

- Verifying the Express adapter works under continuous mixed traffic
- Observing quarantine accumulation and TTL decay over time
- Detecting obvious memory leaks in a short developer session (30 min – a few hours)
- Confirming deduplication, rate limiting, and fail-open behaviour on your own machine

## Traffic mix

| Lane       | Share | Source IP        | Threat headers     |
| ---------- | ----- | ---------------- | ------------------ |
| Clean      | ~75%  | 20 rotating IPs  | None               |
| Injection  | ~12%  | `192.168.100.10` | `injection / high` |
| DDoS       | ~5%   | `192.168.100.20` | `ddos / critical`  |
| Flood      | ~4%   | `192.168.100.30` | `flood / medium`   |
| Rate probe | ~4%   | `192.168.100.40` | None               |

## Getting started

```bash
# From the monorepo root — build dependencies first
pnpm --filter @tracehound/core build
pnpm --filter @tracehound/express build

# Build the soak package
pnpm --filter @tracehound/soak build

# Run
node packages/soak/dist/main.js
```

Or use the convenience script from the soak package directory:

```bash
cd packages/soak
pnpm dev       # tsc + node dist/main.js
```

## Configuration

All options are environment variables — no config file needed.

| Variable        | Default | Description                  |
| --------------- | ------- | ---------------------------- |
| `SOAK_PORT`     | `8099`  | TCP port for the Express app |
| `SOAK_RPS`      | `10`    | Target requests per second   |
| `SOAK_INTERVAL` | `5000`  | Metrics sample interval (ms) |

Example — higher load:

```log
SOAK_RPS=50 SOAK_INTERVAL=2000 node packages/soak/dist/main.js
```

## Metrics output

Status lines are printed to stdout every `SOAK_INTERVAL` ms:

```log
[2026-03-11T14:45:08Z] uptime=55s heap=16.5/17.9MB rss=54.1MB |
  total=   497 clean=   392 quar=    75 ign=    30 rl=     0 err=   0 |
  Q[75 items / 0MB] | tx=497 ok=422 403=75 429=0 5xx=0 tErr=0
```

Each sample is also appended as a JSONL record to `packages/soak/logs/metrics.jsonl`.
Analyse with `jq`:

```bash
jq '.memory.heapUsedMb' packages/soak/logs/metrics.jsonl   # heap trend
jq '.quarantine.count'  packages/soak/logs/metrics.jsonl   # quarantine fill
jq '.agent.quarantined' packages/soak/logs/metrics.jsonl   # cumulative quarantine events
```

## Stopping

`Ctrl+C` (SIGINT) triggers a graceful shutdown:

1. Traffic generator stops immediately
2. Final metrics sample is written
3. HTTP server closes
4. Tracehound shuts down (hound pool + snapshot loop)

## Notes

- `app.set('trust proxy', true)` is enabled so `X-Forwarded-For` is respected.
  This mirrors a typical load-balancer deployment and allows diverse simulated
  source IPs to be visible to the rate limiter.
- Threat signals are conveyed via `x-soak-threat-category` / `x-soak-threat-severity`
  request headers — a simulation of upstream WAF tagging. Tracehound itself
  performs no detection.
- `rawBody` is captured via `express.json({ verify })` so each unique POST body
  produces a distinct SHA-256 signature, exercising quarantine accumulation.
