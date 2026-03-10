# Copilot Coding Agent Instructions for `tracehound/tracehound`

## Repository quick map

- Monorepo managed with **pnpm workspaces** (`/pnpm-workspace.yaml`).
- Main packages:
  - `packages/core` → core deterministic runtime security buffer (`@tracehound/core`)
  - `packages/express` → Express adapter (`@tracehound/express`)
  - `packages/fastify` → Fastify adapter (`@tracehound/fastify`)
  - `packages/cli` → CLI tooling
- Shared TypeScript config is in `/tsconfig.base.json` (strict mode + exact optional properties + noUncheckedIndexedAccess).

## First files to read before editing

1. `/README.md` (project purpose and architecture)
2. `/CONTRIBUTING.md` (security-first and deterministic correctness expectations)
3. `/docs/FAIL-OPEN-SPEC.md` (failure behavior is a core invariant)
4. `/docs/API.md` and `/docs/CONFIGURATION.md` (public/runtime contract)
5. `/packages/core/src/types/errors.ts` (error model and error factories)

## Required local setup

- Node is required (CI runs on Node 20/22; see `/.github/workflows/ci.yml`).
- Package manager is **pnpm** (`packageManager` in `/package.json` is `pnpm@9.1.4`).
- If `pnpm` is missing in the environment, bootstrap it with Corepack:
  ```bash
  corepack enable
  corepack prepare pnpm@9.1.4 --activate
  ```

## Commands that match CI

Run from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm test
```

Additional CI/security checks used by workflows:

- `pnpm audit --prod`
- `pnpm test:fuzz:regression`
- `pnpm test:coverage`

## Coding conventions to preserve

- Keep TypeScript **strict** and ESM-compatible import style used in repo.
- Preserve fail-open behavior in runtime/adapters:
  - Express adapter catches errors and calls `next()` when response is not already sent (`/packages/express/src/index.ts`).
  - Fastify adapter catches errors and calls `hookDone()` when response is not already sent (`/packages/fastify/src/index.ts`).
- For typed domain errors, follow existing `TracehoundError` / `Errors.*` patterns in core instead of inventing ad-hoc shapes.
- Keep changes deterministic and bounded in hot paths (per contributing guidance and fail-open spec).

## Testing guidance

- Prefer **targeted package tests** while iterating:
  - `pnpm --filter @tracehound/core test`
  - `pnpm --filter @tracehound/express test`
  - `pnpm --filter @tracehound/fastify test`
  - `pnpm --filter @tracehound/cli test`
- Run root `pnpm build && pnpm lint && pnpm test` before finalizing.
- Coverage thresholds are configured in `/vitest.config.ts`.

## Change scope guidance

- Keep PRs surgical: modify only files needed for the issue.
- Update docs when public behavior/configuration changes.
- Do not weaken fail-open guarantees, evidence integrity behavior, or quarantine/audit invariants without explicit tests and spec updates.

## Troubleshooting

- **Potential issue:** `pnpm: command not found`.
- **Workaround used during onboarding:** Enable Corepack and activate the pinned pnpm version:
  - `corepack enable`
  - `corepack prepare pnpm@9.1.4 --activate`
