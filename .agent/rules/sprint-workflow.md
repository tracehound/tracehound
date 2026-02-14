# Sprint Workflow and Development Discipline

## Pre-Change Gate

Before writing any code, verify:

1. Existing tests pass (`pnpm test` green).
2. The change aligns with an RFC, roadmap item, or explicit issue.
3. If touching `packages/core/src/core/`, confirm RFC reference exists.

## Post-Change Gate

After every change, before committing:

1. Run affected package tests: `pnpm --filter @tracehound/<pkg> test`
2. Verify coverage has not decreased from current thresholds.
3. Run linter and confirm zero new warnings/errors.
4. If public API changed: update `docs/API.md` in the same commit.
5. If configuration changed: update `docs/CONFIGURATION.md`.
6. If breaking change: add entry to `packages/core/CHANGELOG.md`.

## Commit Convention

Format: `<type>(<scope>): <description>`

| Type       | Usage                                                  |
| ---------- | ------------------------------------------------------ |
| `feat`     | New feature or public API addition                     |
| `fix`      | Bug fix                                                |
| `security` | Security patch or hardening (triggers security review) |
| `refactor` | Internal restructuring with no behavior change         |
| `test`     | Adding or updating tests only                          |
| `docs`     | Documentation only                                     |
| `chore`    | Build, tooling, dependency updates                     |
| `perf`     | Performance improvement with benchmarks                |

- Scope: `core`, `express`, `fastify`, `cli`, `docs`, `rfc`
- Breaking changes: append `!` after type -- `feat(core)!: rename Evidence API`
- Body: explain WHY, not WHAT. The diff shows WHAT.
- Security commits MUST include threat description in body.

## PR Review Checklist

Every PR must satisfy ALL items before merge:

- [ ] All tests pass (unit + integration)
- [ ] Coverage thresholds maintained (90/90/90/85)
- [ ] No new linter warnings
- [ ] Security review: no hardcoded secrets, no PII exposure, no unbounded allocations
- [ ] RFC alignment: changes consistent with referenced RFC
- [ ] Documentation updated (API.md, CONFIGURATION.md, CHANGELOG.md as needed)
- [ ] Breaking changes: migration path documented
- [ ] Rollback plan: documented for major changes

## Sprint Cycle

- Each sprint = 1 roadmap phase or sub-phase.
- Sprint starts with: scope definition referencing roadmap items.
- Sprint ends with: all tests green, coverage maintained, CHANGELOG updated.
- No partial features merged to `main`. Use feature branches.

## Rollback Policy

- Every major change must be revertable with a single `git revert`.
- Database/storage schema changes must include backward-compatible migration.
- Feature flags for risky changes: implement behind config option first.

## Release Process

1. All tests green + coverage thresholds met.
2. CHANGELOG.md updated with version and date.
3. Version bump in package.json files.
4. Tag: `v<major>.<minor>.<patch>` (e.g., `v1.1.0`).
5. No `--force` push to `main`. Ever.
