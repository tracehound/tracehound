import { createTracehound, generateSecureId } from "@tracehound/core";
import { tracehound } from "@tracehound/express";
import express from "express";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the compiled hound-process.js from the monorepo dist output.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HOUND_PROCESS_PATH = resolve(
  __dirname,
  "../../packages/core/dist/core/hound-process.js",
);

// Create a Tracehound instance with very low constraints for testing.
// HoundPool is automatically wired to the Agent inside createTracehound():
// quarantined evidence is forwarded to the pool without any manual activation.
const th = createTracehound({
  houndPool: {
    poolSize: 2, // Tiny pool to exhaust quickly
    timeout: 100, // 100ms timeout for pool exhaustion testing
    onPoolExhausted: "defer",
    deferQueueLimit: 10,
    processScriptPath: HOUND_PROCESS_PATH,
  },
  quarantine: {
    maxBytes: 1024 * 1024 * 10, // 10MB memory ceiling
    maxCount: 1000,
  },
  rateLimit: {
    windowMs: 60 * 1000,
    maxRequests: 50000, // High rate limit to isolate testing to IPC/pool behaviour
    blockDurationMs: 60_000,
  },
});

const app = express();
app.disable("x-powered-by");
const port = 3000;

app.use(express.json());

app.use(
  tracehound({
    agent: th.agent,
    extractScent: (req) => {
      const forwardedRequestId = Array.isArray(req.headers["x-request-id"])
        ? req.headers["x-request-id"][0]
        : (req.headers["x-request-id"] as string);

      return {
        id: `chaos-${generateSecureId()}`,
        timestamp: Date.now(),
        source: req.ip || "127.0.0.1",
        threat: req.headers["x-chaos-threat"]
          ? {
              category: "injection",
              severity: "critical",
              confidence: 0.99,
              source: "chaos-tester",
            }
          : undefined,
        payload: {
          forwardedRequestId,
          method: req.method,
          path: req.path,
          query: req.query as any,
          headers: req.headers as any,
          body: req.body || {},
        },
      };
    },
  }),
);

app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post("/api/data", (_req, res) => {
  res.status(200).json({ message: "Data received" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(
    `[Chaos Server] Tracehound target application listening on port ${port}`,
  );
  console.log(
    `[Chaos Server] HoundPool processScriptPath: ${HOUND_PROCESS_PATH}`,
  );
});
