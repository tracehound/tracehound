import express from 'express'
import { tracehound } from '@tracehound/express'
import { createTracehound } from '@tracehound/core'

// Create a Tracehound instance with very low constraints for testing
const th = createTracehound({
  houndPool: {
    poolSize: 2, // Tiny pool to exhaust quickly
    timeout: 100, // 100ms timeout for Zombie Hound testing
    onPoolExhausted: 'defer',
    deferQueueLimit: 10,
  },
  quarantine: {
    maxBytes: 1024 * 1024 * 10, // 10MB memory ceiling
    maxCount: 1000,
  },
  rateLimit: {
    windowMs: 60 * 1000,
    maxRequests: 50000, // High rate limit to isolate testing to IPC/Memory
    blockDurationMs: 60_000,
  },
})

const app = express()
const port = 3000

app.use(express.json())

// Inject Tracehound middleware using the generated agent
app.use(
  tracehound({
    agent: th.agent,
    extractScent: (req) => {
      // Generate scent, injecting an artificial threat if the x-chaos-threat header is present
      return {
        id: (req.headers['x-request-id'] as string) || `chaos-${Date.now()}-${Math.random()}`,
        timestamp: Date.now(),
        source: req.ip || '127.0.0.1',
        threat: req.headers['x-chaos-threat']
          ? {
              category: 'injection', // Can be standard categories like injection
              severity: 'critical',
              confidence: 0.99,
              source: 'chaos-tester',
            }
          : undefined,
        payload: {
          method: req.method,
          path: req.path,
          query: req.query as any,
          headers: req.headers as any,
          body: req.body || {},
        },
      }
    },
  }),
)

// Regular health check endpoint (no threat)
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' })
})

// Chaos testing endpoint
app.post('/api/data', (req, res) => {
  res.status(200).json({ message: 'Data received', data: req.body })
})

app.listen(port, '0.0.0.0', () => {
  console.log(`[Chaos Server] Tracehound target application listening on port ${port}`)
})
