# Adapter Development Rules

## Thin Wrapper Principle

Adapters are ONLY translation layers between framework APIs and `@tracehound/core`.

- NO business logic in adapters. Zero security decisions.
- NO state stored in adapter layer. All state lives in core.
- NO direct imports from `packages/core/src/core/`. Use only the public API from `@tracehound/core` index exports.
- Adapter complexity ceiling: each adapter should be a single file under 200 lines.

## Request Extraction (Read-Only)

- Extract Scent data from framework request objects using read-only access.
- NEVER mutate `req`, `res`, `request`, or `reply` objects.
- NEVER attach properties to request objects (no `req.tracehound = ...`).
- Extract only: IP/source, path, method, headers needed for Scent construction.

## HTTP Status Mapping (Fixed)

| InterceptResult.status | HTTP Response                                                    |
| ---------------------- | ---------------------------------------------------------------- |
| `clean`                | Call `next()` / continue pipeline                                |
| `quarantined`          | 403 Forbidden                                                    |
| `rate_limited`         | 429 Too Many Requests                                            |
| `payload_too_large`    | 413 Payload Too Large                                            |
| `ignored`              | Call `next()` / continue pipeline (duplicate threat)             |
| `error`                | 500 Internal Server Error (fail-open: consider calling `next()`) |

Do NOT customize status codes. This mapping is normative.

## Error Handling in Adapters

- If `agent.intercept()` throws (should not, but defense-in-depth): catch and call `next()`.
- Adapters MUST be fail-open. A broken adapter = transparent passthrough, not blocked traffic.
- Log adapter errors via framework's native logger, not console.

## Testing Requirements

- Each adapter MUST have a smoke test (`tests/middleware.test.ts` or `tests/plugin.test.ts`).
- Test all HTTP status mappings with mocked core responses.
- Test fail-open behavior: mock core to throw, verify request passes through.
- Test Scent extraction: verify correct fields extracted from framework request.

## Versioning and Compatibility

- Adapter version tracks independently from core (currently v0.7.0).
- Peer dependency ranges: Express `^4.0.0 || ^5.0.0`, Fastify `^4.0.0`.
- When core public API changes, ALL adapters must be updated in the SAME PR.
- Adapter MUST NOT pin core to exact version. Use workspace protocol: `workspace:*`.

## New Adapter Checklist

When adding a new framework adapter (e.g., Hono, Koa, NestJS):

1. Create `packages/<framework>/` following existing structure.
2. Single source file implementing framework-specific integration.
3. Smoke test with all status code mappings.
4. Add to `pnpm-workspace.yaml`.
5. Add to root README.md project structure section.
6. Peer dependency on the framework, workspace dependency on core.
