# Kubernetes Deployment Guide

> **Version:** 1.0
> **Applies to:** @tracehound/core v1.0.0+
> **Status:** Production Ready

---

## Overview

This guide covers deploying Tracehound-enabled Node.js applications on Kubernetes. Tracehound operates as an in-process library — there is no separate service to deploy. The focus is on resource tuning, ConfigMap-driven configuration, health probes, and HPA scaling.

---

## Architecture in K8s

```
┌─────────────────────────────────────────────────────────┐
│  K8s Cluster                                            │
│                                                         │
│  ┌─────────────────────┐    ┌───────────────────────┐   │
│  │  Pod (App + TH)     │    │  Pod (App + TH)       │   │
│  │  ┌───────────────┐  │    │  ┌───────────────┐    │   │
│  │  │  Node.js App  │  │    │  │  Node.js App  │    │   │
│  │  │  ┌──────────┐ │  │    │  │  ┌──────────┐ │    │   │
│  │  │  │Tracehound│ │  │    │  │  │Tracehound│ │    │   │
│  │  │  └──────────┘ │  │    │  │  └──────────┘ │    │   │
│  │  └───────────────┘  │    │  └───────────────┘    │   │
│  │         │           │    │         │             │   │
│  │    Hound Processes  │    │    Hound Processes    │   │
│  └─────────────────────┘    └───────────────────────┘   │
│              │                          │               │
│              └──────────┬───────────────┘               │
│                         ▼                               │
│              ┌─────────────────────┐                    │
│              │  S3 / R2 / GCS     │                    │
│              │  (Cold Storage)     │                    │
│              └─────────────────────┘                    │
└─────────────────────────────────────────────────────────┘
```

**Key points:**
- Tracehound runs **inside** each application pod (not as a sidecar)
- Each pod has its own quarantine buffer (process-local)
- Hound child processes are bounded by `HoundPool.maxActive`
- Cold storage (S3/R2/GCS) is shared across all pods

---

## Resource Requirements

### Minimum Resources (per pod)

| Resource | Request | Limit  | Notes                                    |
| -------- | ------- | ------ | ---------------------------------------- |
| CPU      | 100m    | 500m   | Agent.intercept() is CPU-light           |
| Memory   | 128Mi   | 512Mi  | Quarantine buffer = primary consumer     |

### Production Resources (per pod)

| Resource | Request | Limit  | Notes                                    |
| -------- | ------- | ------ | ---------------------------------------- |
| CPU      | 250m    | 1000m  | Headroom for Hound child processes       |
| Memory   | 256Mi   | 1Gi    | Quarantine maxBytes + Hound pool buffers |

### Memory Sizing Formula

```
Pod Memory = App Base + Quarantine Buffer + Hound Pool Overhead

Quarantine Buffer ≈ maxCount × avg_evidence_size
Hound Pool        ≈ maxActive × 50MB (child process heap)
```

**Example:** 10,000 evidence × 10KB avg + 4 hounds × 50MB = ~300MB for Tracehound

---

## ConfigMap

Externalize all Tracehound configuration via ConfigMap. Never hardcode in application code.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: tracehound-config
  namespace: production
data:
  # Quarantine
  TRACEHOUND_QUARANTINE_MAX_COUNT: "10000"
  TRACEHOUND_QUARANTINE_MAX_BYTES: "104857600"   # 100MB
  TRACEHOUND_QUARANTINE_EVICTION: "priority"

  # Rate Limiter
  TRACEHOUND_RATE_LIMIT_WINDOW_MS: "60000"
  TRACEHOUND_RATE_LIMIT_MAX_REQUESTS: "1000"
  TRACEHOUND_RATE_LIMIT_BLOCK_MS: "30000"

  # Agent
  TRACEHOUND_MAX_PAYLOAD_SIZE: "1048576"          # 1MB

  # Hound Pool
  TRACEHOUND_HOUND_MAX_ACTIVE: "4"
  TRACEHOUND_HOUND_TIMEOUT_MS: "30000"

  # Cold Storage
  TRACEHOUND_COLD_STORAGE_BUCKET: "tracehound-evidence"
  TRACEHOUND_COLD_STORAGE_PREFIX: "prod/evidence/"
  TRACEHOUND_COLD_STORAGE_REGION: "us-east-1"

  # Scheduler
  TRACEHOUND_SCHEDULER_TICK_MS: "5000"

  # Fail-Safe
  TRACEHOUND_FAILSAFE_PANIC_THRESHOLD: "10"
  TRACEHOUND_FAILSAFE_WINDOW_MS: "60000"
```

### Application Code (reading ConfigMap values)

```typescript
import { createTracehound } from '@tracehound/core'

const th = createTracehound({
  quarantine: {
    maxCount: parseInt(process.env.TRACEHOUND_QUARANTINE_MAX_COUNT ?? '10000'),
    maxBytes: parseInt(process.env.TRACEHOUND_QUARANTINE_MAX_BYTES ?? '104857600'),
    evictionPolicy: (process.env.TRACEHOUND_QUARANTINE_EVICTION as 'priority') ?? 'priority',
  },
  rateLimiter: {
    windowMs: parseInt(process.env.TRACEHOUND_RATE_LIMIT_WINDOW_MS ?? '60000'),
    maxRequests: parseInt(process.env.TRACEHOUND_RATE_LIMIT_MAX_REQUESTS ?? '1000'),
    blockDurationMs: parseInt(process.env.TRACEHOUND_RATE_LIMIT_BLOCK_MS ?? '30000'),
  },
  agent: {
    maxPayloadSize: parseInt(process.env.TRACEHOUND_MAX_PAYLOAD_SIZE ?? '1048576'),
  },
})
```

---

## Deployment Manifest

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
  namespace: production
  labels:
    app: api-server
    security: tracehound
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api-server
  template:
    metadata:
      labels:
        app: api-server
        security: tracehound
    spec:
      containers:
        - name: api-server
          image: your-registry/api-server:v1.0.0
          ports:
            - containerPort: 3000
              name: http
          envFrom:
            - configMapRef:
                name: tracehound-config
          env:
            # Secrets via K8s Secret (never ConfigMap)
            - name: TRACEHOUND_LICENSE_KEY
              valueFrom:
                secretKeyRef:
                  name: tracehound-secrets
                  key: license-key
            - name: AWS_ACCESS_KEY_ID
              valueFrom:
                secretKeyRef:
                  name: aws-credentials
                  key: access-key-id
            - name: AWS_SECRET_ACCESS_KEY
              valueFrom:
                secretKeyRef:
                  name: aws-credentials
                  key: secret-access-key
          resources:
            requests:
              cpu: 250m
              memory: 256Mi
            limits:
              cpu: 1000m
              memory: 1Gi
          livenessProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 10
            periodSeconds: 15
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
            failureThreshold: 2
          startupProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 3
            periodSeconds: 5
            failureThreshold: 10
          securityContext:
            runAsNonRoot: true
            runAsUser: 1000
            readOnlyRootFilesystem: true
            allowPrivilegeEscalation: false
            capabilities:
              drop:
                - ALL
      terminationGracePeriodSeconds: 30
```

---

## Health Check Endpoints

Tracehound is fail-open — health checks reflect the **application** health, not Tracehound's internal state. However, exposing Tracehound status via readiness is recommended.

### Express Example

```typescript
import express from 'express'
import { createTracehound } from '@tracehound/core'

const app = express()
const th = createTracehound({ /* config */ })

// Liveness: is the process alive?
app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' })
})

// Readiness: is the app ready to serve traffic?
app.get('/readyz', (_req, res) => {
  const snapshot = th.getSnapshot()

  // Application is always ready (fail-open)
  // But we expose Tracehound status for observability
  res.status(200).json({
    status: 'ready',
    tracehound: {
      quarantine: {
        count: snapshot.quarantine.count,
        utilization: snapshot.quarantine.utilizationPercent,
      },
      rateLimiter: {
        blocked: snapshot.rateLimiter.blockedSources,
      },
    },
  })
})
```

**Important:** Never make readiness depend on Tracehound state. Tracehound is fail-open — if it's degraded, traffic should still flow.

---

## Horizontal Pod Autoscaler (HPA)

Scale based on CPU utilization. Tracehound's Agent.intercept() adds minimal CPU overhead (p99 < 2ms), so HPA thresholds should be based on your application's profile.

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-server-hpa
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-server
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Pods
          value: 2
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Pods
          value: 1
          periodSeconds: 120
```

### Scaling Considerations

| Factor                    | Impact                                              |
| ------------------------- | --------------------------------------------------- |
| Quarantine buffer         | Per-pod. More pods = more total quarantine capacity  |
| Hound child processes     | Per-pod. Keep `maxActive` low (2-4) to limit memory |
| Cold storage writes       | Shared. S3 handles concurrent writes from all pods  |
| Rate limiter state        | Per-pod. Distributed rate limiting requires Redis    |

---

## Secrets Management

**Never store secrets in ConfigMap or environment variables directly.**

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: tracehound-secrets
  namespace: production
type: Opaque
data:
  license-key: <base64-encoded-key>
```

### Recommended Approach

Use an external secrets operator (e.g., AWS Secrets Manager, HashiCorp Vault, External Secrets Operator) to inject secrets at runtime:

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: tracehound-secrets
  namespace: production
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: ClusterSecretStore
  target:
    name: tracehound-secrets
  data:
    - secretKey: license-key
      remoteRef:
        key: tracehound/production/license-key
```

---

## Network Policy

Tracehound does not require network access for core operations. Cold storage writes require S3 egress only.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-server-netpol
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: api-server
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: ingress-controller
      ports:
        - port: 3000
  egress:
    # S3 Cold Storage
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
      ports:
        - port: 443
    # DNS
    - to:
        - namespaceSelector: {}
      ports:
        - port: 53
          protocol: UDP
```

---

## Production Checklist

- [ ] **Resources:** CPU/memory requests and limits set per sizing formula
- [ ] **ConfigMap:** All Tracehound config externalized (not hardcoded)
- [ ] **Secrets:** License key and cloud credentials in K8s Secret (not ConfigMap)
- [ ] **Health probes:** Liveness, readiness, and startup probes configured
- [ ] **HPA:** Autoscaler configured with appropriate min/max replicas
- [ ] **Security context:** `runAsNonRoot`, `readOnlyRootFilesystem`, dropped capabilities
- [ ] **Network policy:** Egress limited to S3 (port 443) and DNS
- [ ] **Cold storage:** S3 bucket created with versioning and lifecycle policy
- [ ] **Monitoring:** Tracehound snapshot metrics exported to Prometheus/Datadog
- [ ] **Node flags:** `--frozen-intrinsics` recommended for production

---

## Monitoring & Observability

### Prometheus Metrics (Recommended)

Expose Tracehound internals as Prometheus metrics via a `/metrics` endpoint:

```typescript
// Example: custom Prometheus exporter
app.get('/metrics', (_req, res) => {
  const snapshot = th.getSnapshot()

  const metrics = [
    `# HELP tracehound_quarantine_count Current evidence count in quarantine`,
    `# TYPE tracehound_quarantine_count gauge`,
    `tracehound_quarantine_count ${snapshot.quarantine.count}`,
    ``,
    `# HELP tracehound_quarantine_bytes Current bytes used by quarantine`,
    `# TYPE tracehound_quarantine_bytes gauge`,
    `tracehound_quarantine_bytes ${snapshot.quarantine.bytes}`,
    ``,
    `# HELP tracehound_intercepts_total Total intercept operations`,
    `# TYPE tracehound_intercepts_total counter`,
    `tracehound_intercepts_total ${snapshot.agent.totalIntercepts}`,
  ].join('\n')

  res.set('Content-Type', 'text/plain')
  res.send(metrics)
})
```

### Key Metrics to Monitor

| Metric                          | Alert Threshold         | Description                         |
| ------------------------------- | ----------------------- | ----------------------------------- |
| `quarantine_count`              | > 80% of maxCount       | Quarantine nearing capacity         |
| `quarantine_bytes`              | > 80% of maxBytes       | Memory pressure from evidence       |
| `rate_limiter_blocked_sources`  | Spike > 3x baseline     | Possible attack wave                |
| `fail_safe_panic_count`         | > 0                     | Tracehound internal failure         |

---

## Troubleshooting

### Pod OOM Killed

**Cause:** Quarantine buffer + Hound processes exceed memory limit.

**Fix:**
1. Reduce `TRACEHOUND_QUARANTINE_MAX_BYTES`
2. Reduce `TRACEHOUND_HOUND_MAX_ACTIVE`
3. Increase pod memory limit

### High CPU Usage

**Cause:** Evidence compression (gzip) under heavy attack load.

**Fix:**
1. Ensure Async Codec is used for cold storage operations
2. Reduce `TRACEHOUND_QUARANTINE_MAX_COUNT` to limit compression work
3. Scale out via HPA

### Cold Storage Write Failures

**Cause:** S3 connectivity or permissions issue.

**Fix:**
1. Verify network policy allows port 443 egress
2. Check IAM role / service account permissions
3. Tracehound is fail-open — writes fail silently, application continues

---

**Last Updated:** 2026-02-10
