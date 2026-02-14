# TypeScript Coding Standards

## Strict Typing

- `any` type is FORBIDDEN. Use `unknown` with type guards or explicit narrow types.
- `as` type assertions are discouraged. Prefer type guards (`if ('prop' in obj)`), discriminated unions, or `satisfies`.
- `@ts-ignore` and `@ts-expect-error` are FORBIDDEN unless accompanied by a linked issue/RFC justification comment.
- All functions MUST have explicit return types. No inferred returns on public API.
- `noUncheckedIndexedAccess` is enabled. Always handle `| undefined` from index access.

## Error Handling

- NEVER use `throw new Error(...)`. Use `TracehoundError` via the `Errors` factory in `types/errors.ts`.
- Every catch block MUST produce a typed `TracehoundError` or return a safe `InterceptResult`. Swallowing exceptions silently is FORBIDDEN.
- `recoverable` field must be set intentionally: `true` = caller can retry, `false` = permanent failure.
- Error codes follow `DOMAIN_SPECIFIC_ERROR` format (e.g., `AGENT_PAYLOAD_TOO_LARGE`).

## Import Conventions

- File imports MUST include `.js` extension: `import { X } from './module.js'`
- Type-only imports MUST use `import type`: `import type { Foo } from './types.js'`
- No default exports. All exports are named.
- No circular imports. Dependency direction: `types/ <- utils/ <- core/`

## Immutability

- Prefer `readonly` on interface properties and function parameters.
- Mutable state is ONLY allowed inside: `Quarantine.store`, `RateLimiter.state`, `SecurityState.history`.
- Return immutable snapshots from public API (use spread or `Object.freeze` for shallow copies).
- NEVER mutate function arguments.

## Synchronous Hot Path

- The Agent `intercept()` flow is fully synchronous. No `async`, no `Promise`, no `setTimeout` in the intercept path.
- Async operations are ONLY allowed in: HoundPool activation, ColdStorage write, Notification dispatch.
- Scheduler tasks may be async but MUST have timeout guards.

## Forbidden Constructs

```typescript
// FORBIDDEN -- these are security vulnerabilities in a security product
eval(...)
new Function(...)
Function(...)
Object.setPrototypeOf(...)
obj.__proto__ = ...
Reflect.setPrototypeOf(...)
```

## Formatting Conventions

- Numeric literals over 999 MUST use underscore separators: `1_000_000`, not `1000000`.
- JSDoc on all exported functions and interfaces. Include `@param`, `@returns`, and `SECURITY:` warnings where applicable.
- Section separators in files use the project style:
  ```typescript
  // ─────────────────────────────────────────────────────────────────────────────
  // Section Name
  // ─────────────────────────────────────────────────────────────────────────────
  ```
- No `console.log` in production code. Use `NotificationEmitter` for observable events.
