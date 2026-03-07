## Summary

Describe the change and why it is needed.

## Scope

- [ ] `@tracehound/core`
- [ ] `@tracehound/express`
- [ ] `@tracehound/fastify`
- [ ] `@tracehound/cli`
- [ ] docs
- [ ] ci/release

## RFC / Design Rationale

Link the relevant RFC, issue, or design notes. If this changes `packages/core/src/core/`, include the governing RFC or explicit design rationale.

## Validation

- [ ] `pnpm --filter @tracehound/<pkg> test` or equivalent affected tests
- [ ] `pnpm lint`
- [ ] Coverage unchanged or improved
- [ ] I did not add threat detection logic to core
- [ ] I preserved fail-open behavior where applicable

## Docs and Release Notes

- [ ] No public API or configuration changes
- [ ] Updated `docs/API.md` if public API changed
- [ ] Updated `docs/CONFIGURATION.md` if configuration changed
- [ ] Updated changelog or migration notes if this is breaking

## Risk and Rollback

Describe operational risk, rollout constraints, and how to revert this change if needed.
