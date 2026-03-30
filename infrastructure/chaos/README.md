# Tracehound Chaos Testing

Local chaos validation harness for Tracehound release artifacts.

## Commands

```bash
pnpm --filter tracehound-chaos-testing build
pnpm --filter tracehound-chaos-testing test
pnpm --filter tracehound-chaos-testing start
```

The root `pnpm test:chaos` command builds the workspace and then executes this package's compiled test runner.
