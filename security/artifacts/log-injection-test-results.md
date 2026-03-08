# Log Injection Test Results

**Date:** 2026-03-07
**Scope:** `packages/core/src` — all log-producing and event-emitting code paths

## Method

Static analysis via ripgrep scan for:

- Direct log sinks: `console.log`, `console.warn`, `console.error`, `console.info`
- Event emission paths that carry user-controlled fields: `notifications.emit`
- Webhook delivery of those events: `notification-emitter.ts`

## Findings

### 1. Direct console usage

| File               | Line | Sink           | Input origin  | Risk |
| ------------------ | ---- | -------------- | ------------- | ---- |
| `utils/runtime.ts` | 59   | `console.warn` | Internal only | None |

`runtime.ts:59` logs a pre-constructed message about missing Node.js flags. The message
is built from a hardcoded list of flag names joined with `, ` — no user-controlled data
is interpolated.

**Finding: no log injection surface via direct console calls.**

### 2. Notification event fields with user-controlled data

`agent.ts` forwards `scent.source` in two notification events:

- `rate_limit.exceeded` — carries `source: scent.source`
- `threat.detected` — carries `source: scent.source`

`scent.source` is a string set by the caller of `Agent.ingest()` — it can contain
arbitrary attacker-controlled input (e.g. HTTP `User-Agent`, URL path, etc.).

The core library itself does not write this to any log sink. It is delivered to consumer
webhook endpoints over HTTPS via `notification-emitter.ts`.

**Risk transfer:** If a consumer logger receives the notification event and logs `source`
without sanitization, log injection is possible at the consumer layer. This is a
consumer responsibility, documented as LOG-03.

**Finding: the core library does not directly log attacker-controlled fields. Risk is
correctly pushed to the consumer boundary.**

### 3. Webhook delivery body

`notification-emitter.ts` serializes the full event payload (including `source`) as JSON
and sends it to the configured webhook URL. JSON encoding escapes control characters,
newlines, and special bytes by design.

**Finding: webhook delivery does not introduce log injection — JSON encoding neutralises
CRLF and control characters.**

### 4. Crash/error outputs

`system.panic` events carry only `reason` values sourced from the `SYSTEM_PANIC_REASONS`
constant map — these are internal string literals, not user input.

**Finding: panic log paths are not injectable.**

## Summary

| Test Case                              | Result |
| -------------------------------------- | ------ |
| Direct console calls log user input    | Pass   |
| `scent.source` written to log sink     | Pass   |
| Webhook body CRLF injection via source | Pass   |
| Panic reason sourced from user input   | Pass   |
| Signature / hash fields in logs        | Pass   |

All tested paths pass. Residual consumer-side risk is covered by policy rule LOG-03.
