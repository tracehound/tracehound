---
description: Sprint workflow for Tracehound: Enforces pre-change and post-change gates to maintain security and integrity.
---

# Sprint Workflow

This workflow ensures that all changes follow the strict Tracehound development discipline.

## Pre-Change Gate

Before writing any code, verify project health and alignment.

1. Run all tests to ensure a green baseline.
   ```bash
   pnpm test
   ```
2. Verify alignment with RFCs or issues.
3. If modifying `packages/core/src/core/`, ensure an RFC reference exists in your task.

## Post-Change Gate

After implementing changes, run the baseline verification suite.

1. Run tests for the affected package.
   ```bash
   pnpm --filter @tracehound/<pkg> test
   ```
2. Check coverage status.
   ```bash
   pnpm coverage
   ```
3. Run linter.
   ```bash
   pnpm lint
   ```
4. Update documentation if API or Configuration changed.
   - `docs/API.md`
   - `docs/CONFIGURATION.md`
5. Update `packages/core/CHANGELOG.md` if the change is breaking.
6. Commit using the `<type>(<scope>): <description>` format.
