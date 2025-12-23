# Scenarios

Real-world validation scenarios for Tracehound.

## Structure

```
scenarios/
├── utils/           # Shared utilities (memory-delta, etc.)
├── server/          # Minimal HTTP server (future)
└── *.ts             # Standalone scenario scripts
```

## Running

```bash
npx tsx scenarios/<name>.ts
```
