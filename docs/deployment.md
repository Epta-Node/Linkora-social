# Linkora Backend Services — Deployment Guide

This guide covers production deployment of the three Linkora backend services:

| Service                     | Default Port | Description                                            |
| --------------------------- | ------------ | ------------------------------------------------------ |
| `services/indexer`          | 3000         | Off-chain Soroban event indexer and REST/WebSocket API |
| `services/dm-relay`         | 3001         | Transport-only E2EE direct-message relay               |
| `services/analytics-oracle` | 4000         | Ed25519 analytics attestation oracle                   |

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Environment Variable Reference](#2-environment-variable-reference)
   - [Shared rate limiting (`REDIS_URL`)](#24-shared-rate-limiting-redis_url)
3. [Database Migration Steps](#3-database-migration-steps)
4. [Docker Compose Deployment](#4-docker-compose-deployment)
5. [Kubernetes Deployment](#5-kubernetes-deployment)
6. [Health Check Endpoints](#6-health-check-endpoints)
7. [Scaling Guidelines](#7-scaling-guidelines)
8. [Monitoring and Alerting](#8-monitoring-and-alerting)
9. [Backup and Recovery](#9-backup-and-recovery)

---

## 1. Prerequisites

| Dependency  | Minimum Version | Notes                                                                                                   |
| ----------- | --------------- | ------------------------------------------------------------------------------------------------------- |
| Docker      | 24+             | Compose v2 required (`docker compose`)                                                                  |
| PostgreSQL  | 15+             | One database per service (or shared with separate schemas)                                              |
| Redis       | 7+              | **Required in production** — backs shared rate limiting; see [§2.4](#24-shared-rate-limiting-redis_url) |
| Stellar RPC | —               | Horizon-compatible Soroban RPC endpoint (testnet or mainnet)                                            |
| Node.js     | 18+             | Only needed for local builds outside Docker                                                             |

---

## 2. Environment Variable Reference

### 2.1 Indexer (`services/indexer`)

| Variable                                | Required | Default                    | Description                                                                                                                                                                                         |
| --------------------------------------- | -------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                          | ✅       | —                          | PostgreSQL connection string, e.g. `postgresql://user:pass@host:5432/linkora_indexer`                                                                                                               |
| `STELLAR_RPC_URL`                       | ✅       | —                          | Soroban RPC endpoint, e.g. `https://soroban-testnet.stellar.org`                                                                                                                                    |
| `CONTRACT_ID`                           | ✅       | —                          | Linkora contract address on the Stellar network                                                                                                                                                     |
| `START_LEDGER`                          | ✅       | —                          | Ledger sequence to begin indexing from (use the contract deployment ledger)                                                                                                                         |
| `PORT`                                  |          | `3000`                     | HTTP/WebSocket server port                                                                                                                                                                          |
| `REDIS_URL`                             | ✅¹      | —                          | Redis connection string backing the shared rate limiter, e.g. `redis://redis:6379`. **Startup fails when `NODE_ENV=production` and this is unset** — see [§2.4](#24-shared-rate-limiting-redis_url) |
| `ALLOW_IN_MEMORY_RATE_LIMIT`            |          | `false`                    | Opt out of the `REDIS_URL` requirement for a deliberately single-replica production deployment. Limits become per-instance                                                                          |
| `RATE_LIMIT_ANON_RPM`                   |          | `100`                      | Max read requests per minute for unauthenticated IPs                                                                                                                                                |
| `RATE_LIMIT_AUTH_RPM`                   |          | `300`                      | Max requests per minute for authenticated Stellar addresses                                                                                                                                         |
| `RATE_LIMIT_WRITE_RPM`                  |          | `50`                       | Max write requests per minute for unauthenticated IPs                                                                                                                                               |
| `RPC_RATE_LIMIT_PER_SEC`                |          | `10`                       | Outbound Soroban RPC calls per second (token-bucket)                                                                                                                                                |
| `RPC_RATE_LIMIT_BURST`                  |          | `= RPC_RATE_LIMIT_PER_SEC` | Burst capacity for outbound RPC calls                                                                                                                                                               |
| `MIN_POLL_INTERVAL_MS`                  |          | —                          | Minimum interval (ms) between event-stream polls                                                                                                                                                    |
| `MAX_POLL_INTERVAL_MS`                  |          | —                          | Maximum interval (ms) between event-stream polls (adaptive back-off ceiling)                                                                                                                        |
| `SCORE_REFRESH_INTERVAL_MINUTES`        |          | `5`                        | How often creator feed scores are recalculated                                                                                                                                                      |
| `BACKFILL_MAX_DEPTH_LEDGERS`            |          | `10000`                    | Maximum ledgers to backfill in one recovery run. Larger gaps raise an alert instead                                                                                                                 |
| `BACKFILL_BATCH_SIZE`                   |          | `100`                      | Ledgers fetched per batch during backfill                                                                                                                                                           |
| `BACKFILL_RATE_LIMIT_MS`                |          | `100`                      | Delay (ms) between backfill batches                                                                                                                                                                 |
| `BACKFILL_ALERT_THRESHOLD`              |          | `5000`                     | Alert when a detected gap exceeds this many ledgers                                                                                                                                                 |
| `BACKFILL_CIRCUIT_BREAKER_MAX_FAILURES` |          | `5`                        | Stop backfilling after this many consecutive batch failures                                                                                                                                         |
| `STATEMENT_TIMEOUT_MS`                  |          | `30000`                    | PostgreSQL statement timeout                                                                                                                                                                        |
| `LOCK_TIMEOUT_MS`                       |          | `10000`                    | PostgreSQL lock timeout                                                                                                                                                                             |
| `SLOW_QUERY_THRESHOLD_MS`               |          | `5000`                     | Log queries slower than this threshold                                                                                                                                                              |

### 2.2 DM Relay (`services/dm-relay`)

| Variable                     | Required | Default                 | Description                                                                                                                                     |
| ---------------------------- | -------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`               | ✅       | —                       | PostgreSQL connection string, e.g. `postgresql://user:pass@host:5432/linkora_dm`                                                                |
| `PORT`                       |          | `3001`                  | HTTP server port                                                                                                                                |
| `NODE_ENV`                   |          | `development`           | Set to `production` in production                                                                                                               |
| `CORS_ORIGIN`                |          | `http://localhost:3000` | Comma-separated list of allowed CORS origins                                                                                                    |
| `MESSAGE_TTL_DAYS`           |          | `7`                     | Days to retain delivered messages before the cleanup job removes them                                                                           |
| `MAX_TIMESTAMP_SKEW`         |          | `30`                    | Maximum age (seconds) of a Stellar auth timestamp before it is rejected                                                                         |
| `STELLAR_NETWORK`            |          | `Testnet`               | Stellar network passphrase identifier (`Testnet` or `Mainnet`)                                                                                  |
| `IDEMPOTENCY_TTL_HOURS`      |          | `24`                    | Hours to retain idempotency keys for deduplication                                                                                              |
| `REDIS_URL`                  | ✅¹      | —                       | Redis connection string backing the shared HTTP **and WebSocket** rate limiters. **Startup fails when `NODE_ENV=production` and this is unset** |
| `ALLOW_IN_MEMORY_RATE_LIMIT` |          | `false`                 | Opt out of the `REDIS_URL` requirement for a single-replica deployment                                                                          |
| `WS_RATE_LIMIT_MAX`          |          | `30`                    | Max WebSocket connection attempts per minute per IP                                                                                             |
| `RATE_LIMIT_ANON_RPM`        |          | `100`                   | Max requests per minute for unauthenticated IPs                                                                                                 |
| `RATE_LIMIT_AUTH_RPM`        |          | `300`                   | Max requests per minute for authenticated Stellar addresses                                                                                     |

### 2.3 Analytics Oracle (`services/analytics-oracle`)

| Variable                         | Required | Default                             | Description                                                                                                                                 |
| -------------------------------- | -------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                   | ✅       | —                                   | PostgreSQL connection string, e.g. `postgresql://user:pass@host:5432/linkora_indexer` (can share the indexer's DB — read-only queries only) |
| `SOROBAN_RPC_URL`                | ✅       | —                                   | Soroban RPC endpoint                                                                                                                        |
| `CONTRACT_ID`                    | ✅       | —                                   | Linkora contract address                                                                                                                    |
| `SECRETS`                        | ✅       | `env:ORACLE_PRIVATE_KEY_HEX`        | Signing key backend. Use `file:///path/to/key.hex` with a mounted secret in production; env fallback is dev-only                            |
| `ADMIN_SECRET`                   | ⚠️       | —                                   | Bearer token for `POST /admin/rotate-key`. **Keep secret — use a secrets manager**                                                          |
| `PORT`                           |          | `4000`                              | HTTP server port                                                                                                                            |
| `ORACLE_NAME`                    |          | `default`                           | Identifier included in on-chain attestations                                                                                                |
| `WINDOW_LEDGERS`                 |          | `1000`                              | Size of the analytics window in ledgers                                                                                                     |
| `NETWORK_PASSPHRASE`             |          | `Test SDF Network ; September 2015` | Stellar network passphrase for transaction signing                                                                                          |
| `REDIS_URL`                      | ✅¹      | —                                   | Redis connection string backing the shared rate limiter. **Startup fails when `NODE_ENV=production` and this is unset**                     |
| `ALLOW_IN_MEMORY_RATE_LIMIT`     |          | `false`                             | Opt out of the `REDIS_URL` requirement for a single-replica deployment                                                                      |
| `ORACLE_RATE_LIMIT_WINDOW_MS`    |          | `60000`                             | Rate limit window in milliseconds                                                                                                           |
| `ORACLE_RATE_LIMIT_MAX_REQUESTS` |          | `10`                                | Max requests per window per IP                                                                                                              |
| `ORACLE_RATE_LIMIT_BYPASS_IPS`   |          | —                                   | Comma-separated IPs to bypass rate limiting (e.g. internal health checkers)                                                                 |

### 2.4 Shared rate limiting (`REDIS_URL`)

¹ `REDIS_URL` is **required whenever `NODE_ENV=production`**. All three services
refuse to start without it and exit with:

```
[<service>] REDIS_URL is required when NODE_ENV=production. Without it each replica keeps
its own rate-limit counters, so the effective limit becomes RATE_LIMIT × replicaCount and
rate limiting provides no real protection. ...
```

**Why it is mandatory.** Without Redis every replica keeps its own counters. An
attacker distributing requests across a load balancer multiplies their
effective allowance by the replica count:

```
effective_limit = RATE_LIMIT_ANON_RPM × replica_count
```

With three replicas the documented 100 req/min anonymous limit becomes 300
req/min — enough to brute-force authenticated endpoints, flood the indexer API,
or bypass the DM relay's per-address send limits. Nothing in the response makes
this visible, which is why the check happens at startup rather than at runtime.

**Every replica must point at the same Redis endpoint.** Per-replica Redis
instances reproduce the original problem exactly.

**Single-replica escape hatch.** A deployment that genuinely runs one replica
can set `ALLOW_IN_MEMORY_RATE_LIMIT=true` to boot without Redis. That
deployment then reports `rateLimiter: { store: "memory", shared: false }` on
`/health` and its aggregate status is `degraded` — see
[§6](#6-health-check-endpoints). Do not set this on anything that can scale.

---

## 3. Database Migration Steps

### Indexer

The indexer uses plain SQL migrations in `services/indexer/migrations/`, numbered `001_` through `011_`. Apply them in order:

```bash
# Apply all migrations (example using psql)
for f in services/indexer/migrations/*.sql; do
  psql "$DATABASE_URL" -f "$f"
done
```

Migrations are **idempotent** — safe to re-run on an already-migrated database. All statements use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and `ADD COLUMN IF NOT EXISTS`. There are no destructive `DROP` statements.

To validate migrations locally:

```bash
# Requires Docker + Compose v2
bash tests/migrations/test-migrations.sh
```

After an intentional schema change, refresh the snapshot:

```bash
bash tests/migrations/update-schema-snapshot.sh
```

See [`services/indexer/migrations/README.md`](../services/indexer/migrations/README.md) for the full authoring rules and reversibility policy.

### DM Relay

The dm-relay's migrations live in `services/dm-relay/migrations/`:

```bash
psql "$DATABASE_URL" -f services/dm-relay/migrations/001_message_idempotency.sql
psql "$DATABASE_URL" -f services/dm-relay/migrations/002_scope_idempotency_by_sender.sql
```

Or use the built-in migration script:

```bash
cd services/dm-relay && pnpm db:migrate
```

### Analytics Oracle

The oracle reads from the indexer's database (read-only). No schema of its own needs to be created.

---

## 4. Docker Compose Deployment

Save the following as `docker-compose.yml` at the repo root and populate a `.env` file with the required variables.

```yaml
version: "3.9"

services:
  postgres-indexer:
    image: postgres:15-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: linkora_indexer
      POSTGRES_USER: linkora
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - indexer-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U linkora -d linkora_indexer"]
      interval: 10s
      timeout: 5s
      retries: 5

  postgres-dm:
    image: postgres:15-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: linkora_dm
      POSTGRES_USER: linkora
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - dm-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U linkora -d linkora_dm"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  indexer:
    build:
      context: services/indexer
      dockerfile: Dockerfile
    restart: unless-stopped
    depends_on:
      postgres-indexer:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://linkora:${POSTGRES_PASSWORD}@postgres-indexer:5432/linkora_indexer
      STELLAR_RPC_URL: ${STELLAR_RPC_URL}
      CONTRACT_ID: ${CONTRACT_ID}
      START_LEDGER: ${START_LEDGER}
      REDIS_URL: redis://redis:6379
      NODE_ENV: production
    ports:
      - "3000:3000"
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:3000/health/ready || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 30s

  dm-relay:
    build:
      context: services/dm-relay
      dockerfile: Dockerfile
    restart: unless-stopped
    depends_on:
      postgres-dm:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://linkora:${POSTGRES_PASSWORD}@postgres-dm:5432/linkora_dm
      REDIS_URL: redis://redis:6379
      NODE_ENV: production
      STELLAR_NETWORK: ${STELLAR_NETWORK}
      CORS_ORIGIN: ${CORS_ORIGIN}
    ports:
      - "3001:3001"
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:3001/health/ready || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 30s

  analytics-oracle:
    build:
      context: services/analytics-oracle
      dockerfile: Dockerfile
    restart: unless-stopped
    depends_on:
      postgres-indexer:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://linkora:${POSTGRES_PASSWORD}@postgres-indexer:5432/linkora_indexer
      SOROBAN_RPC_URL: ${STELLAR_RPC_URL}
      CONTRACT_ID: ${CONTRACT_ID}
      SECRETS: file:///run/secrets/oracle-key.hex
      ADMIN_SECRET: ${ADMIN_SECRET}
      REDIS_URL: redis://redis:6379
      NODE_ENV: production
      NETWORK_PASSPHRASE: ${NETWORK_PASSPHRASE}
    ports:
      - "4000:4000"
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:4000/health/ready || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 30s

volumes:
  indexer-pgdata:
  dm-pgdata:
  redis-data:
```

Minimal `.env`:

```bash
POSTGRES_PASSWORD=changeme
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
CONTRACT_ID=C...
START_LEDGER=12345678
ADMIN_SECRET=<high-entropy bearer token>
STELLAR_NETWORK=Testnet
NETWORK_PASSPHRASE=Test SDF Network ; September 2015
CORS_ORIGIN=https://app.linkora.io
```

Start all services:

```bash
# Run migrations first
docker compose run --rm indexer sh -c 'for f in /app/migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done'
docker compose run --rm dm-relay pnpm db:migrate

# Start everything
docker compose up -d

# Tail logs
docker compose logs -f indexer dm-relay analytics-oracle
```

---

## 5. Kubernetes Deployment

The manifests below cover a single-namespace production deployment. Adjust resource limits for your cluster.

### 5.1 Secrets

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: linkora-secrets
  namespace: linkora
type: Opaque
stringData:
  DATABASE_URL_INDEXER: "postgresql://linkora:changeme@postgres-indexer:5432/linkora_indexer"
  DATABASE_URL_DM: "postgresql://linkora:changeme@postgres-dm:5432/linkora_dm"
  ORACLE_KEY_HEX: "<32-byte hex>"
  ADMIN_SECRET: "<high-entropy bearer token>"
  REDIS_URL: "redis://redis:6379"
```

### 5.2 Indexer Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: indexer
  namespace: linkora
spec:
  replicas: 2
  selector:
    matchLabels:
      app: indexer
  template:
    metadata:
      labels:
        app: indexer
    spec:
      containers:
        - name: indexer
          image: ghcr.io/epta-node/linkora-indexer:latest
          ports:
            - containerPort: 3000
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: linkora-secrets
                  key: DATABASE_URL_INDEXER
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: linkora-secrets
                  key: REDIS_URL
            - name: STELLAR_RPC_URL
              value: "https://soroban-testnet.stellar.org"
            - name: CONTRACT_ID
              value: "C..."
            - name: START_LEDGER
              value: "12345678"
            - name: NODE_ENV
              value: "production"
          livenessProbe:
            httpGet:
              path: /health/live
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 3000
            initialDelaySeconds: 15
            periodSeconds: 10
          startupProbe:
            httpGet:
              path: /health/startup
              port: 3000
            failureThreshold: 30
            periodSeconds: 10
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "256Mi"
          volumeMounts:
            - name: oracle-key
              mountPath: /run/secrets/oracle-key.hex
              subPath: oracle-key.hex
              readOnly: true
      volumes:
        - name: oracle-key
          secret:
            secretName: linkora-secrets
            items:
              - key: ORACLE_KEY_HEX
                path: oracle-key.hex
              - key: ADMIN_SECRET
                path: admin-secret
---
apiVersion: v1
kind: Service
metadata:
  name: indexer
  namespace: linkora
spec:
  selector:
    app: indexer
  ports:
    - port: 3000
      targetPort: 3000
```

### 5.3 DM Relay Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dm-relay
  namespace: linkora
spec:
  replicas: 2
  selector:
    matchLabels:
      app: dm-relay
  template:
    metadata:
      labels:
        app: dm-relay
    spec:
      containers:
        - name: dm-relay
          image: ghcr.io/epta-node/linkora-dm-relay:latest
          ports:
            - containerPort: 3001
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: linkora-secrets
                  key: DATABASE_URL_DM
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: linkora-secrets
                  key: REDIS_URL
            - name: STELLAR_NETWORK
              value: "Testnet"
            - name: NODE_ENV
              value: "production"
            - name: CORS_ORIGIN
              value: "https://app.linkora.io"
          livenessProbe:
            httpGet:
              path: /health/live
              port: 3001
            initialDelaySeconds: 10
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 3001
            initialDelaySeconds: 15
            periodSeconds: 10
          startupProbe:
            httpGet:
              path: /health/startup
              port: 3001
            failureThreshold: 30
            periodSeconds: 10
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "256Mi"
---
apiVersion: v1
kind: Service
metadata:
  name: dm-relay
  namespace: linkora
spec:
  selector:
    app: dm-relay
  ports:
    - port: 3001
      targetPort: 3001
```

### 5.4 Analytics Oracle Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: analytics-oracle
  namespace: linkora
spec:
  replicas: 1 # Only one oracle should submit attestations to avoid duplicate on-chain txns
  selector:
    matchLabels:
      app: analytics-oracle
  template:
    metadata:
      labels:
        app: analytics-oracle
    spec:
      containers:
        - name: analytics-oracle
          image: ghcr.io/epta-node/linkora-analytics-oracle:latest
          ports:
            - containerPort: 4000
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: linkora-secrets
                  key: DATABASE_URL_INDEXER
            - name: SECRETS
              value: "file:///run/secrets/oracle-key.hex"
            - name: ADMIN_SECRET
              valueFrom:
                secretKeyRef:
                  name: linkora-secrets
                  key: ADMIN_SECRET
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: linkora-secrets
                  key: REDIS_URL
            - name: SOROBAN_RPC_URL
              value: "https://soroban-testnet.stellar.org"
            - name: CONTRACT_ID
              value: "C..."
            - name: NODE_ENV
              value: "production"
          livenessProbe:
            httpGet:
              path: /health/live
              port: 4000
            initialDelaySeconds: 10
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 4000
            initialDelaySeconds: 15
            periodSeconds: 10
          startupProbe:
            httpGet:
              path: /health/startup
              port: 4000
            failureThreshold: 30
            periodSeconds: 10
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "256Mi"
---
apiVersion: v1
kind: Service
metadata:
  name: analytics-oracle
  namespace: linkora
spec:
  selector:
    app: analytics-oracle
  ports:
    - port: 4000
      targetPort: 4000
```

---

## 6. Health Check Endpoints

All three services expose Kubernetes-compatible probes on the same paths:

| Endpoint              | Probe type | Returns 200 when                                                     |
| --------------------- | ---------- | -------------------------------------------------------------------- |
| `GET /health`         | Aggregate  | Dependencies reachable; reports degraded modes                       |
| `GET /health/live`    | Liveness   | Process is running                                                   |
| `GET /health/ready`   | Readiness  | Database (and Stellar RPC for oracle/indexer) reachable              |
| `GET /health/startup` | Startup    | Initial bootstrap complete (first window processed / DB initialised) |

Example readiness response:

```json
{
  "status": "ready",
  "degraded": false,
  "checks": {
    "database": { "status": "up", "latencyMs": 3 },
    "stellar_rpc": { "status": "up", "latencyMs": 45 },
    "rateLimiter": { "store": "redis", "shared": true }
  }
}
```

A `503` response indicates `"not_ready"` — the load balancer should stop routing traffic until the probe recovers.

### Rate limiter status

Every service reports which store backs its rate limiter:

| Field                | Values               | Meaning                                                           |
| -------------------- | -------------------- | ----------------------------------------------------------------- |
| `rateLimiter.store`  | `"redis"`/`"memory"` | The backing store the limiter connected to at startup             |
| `rateLimiter.shared` | `true`/`false`       | Whether limit state is shared across every replica of the service |

When `shared` is `false`, limits are enforced per replica — a scaled deployment's
real limit is `limit × replicaCount`. `GET /health` reports `"status": "degraded"`
in that case:

```json
{
  "status": "degraded",
  "uptime": 421,
  "rateLimiter": { "store": "memory", "shared": false },
  "checks": { "database": { "status": "up", "latencyMs": 3 } }
}
```

This is deliberately **not** a readiness failure. A single-replica deployment
that opted in via `ALLOW_IN_MEMORY_RATE_LIMIT` is still serving correctly, and
removing the pod from the load balancer would turn a weak limit into an outage.
Alert on `status == "degraded"` instead, and treat it as a configuration bug on
anything running more than one replica.

---

## 7. Scaling Guidelines

### Indexer

- **Horizontal scaling is supported** — multiple replicas share rate-limit state via Redis and process the same event stream. The `IngestPipeline` is idempotent (events are deduplicated by `(ledger_sequence, event_index)` primary key), so duplicate processing across replicas is safe.
- `REDIS_URL` is mandatory in production, and every replica must point at the **same** Redis endpoint — per-replica instances give each replica its own counters again. Confirm with `GET /health` → `rateLimiter.shared == true`.
- The WebSocket `/ws` endpoint broadcasts events via the in-process `EventBus`. For multi-replica WebSocket support, route clients to a single replica with sticky sessions, or introduce a Redis pub/sub fanout layer.
- Tune `RPC_RATE_LIMIT_PER_SEC` to stay within your Soroban RPC provider's limits.

### DM Relay

- **Stateless** — all state is in PostgreSQL. Scale replicas freely.
- `REDIS_URL` is mandatory in production and shares both the HTTP counters and the per-IP WebSocket connection limit across replicas. Confirm with `GET /health` → `rateLimiter.shared == true`.
- WebSocket connections (`/ws`) require sticky sessions if scaling to multiple replicas without a shared pub/sub layer.

### Analytics Oracle

- **Run as a single replica.** The oracle signs and submits on-chain attestations; multiple replicas would submit duplicate transactions and waste Stellar fees.
- `REDIS_URL` is still required in production. A single-replica oracle may set `ALLOW_IN_MEMORY_RATE_LIMIT=true` instead, accepting that `/health` reports `degraded`.
- If high availability is required, use a standby replica with a distributed lock (e.g. Redis `SET NX`) to ensure only one instance submits at a time.

---

## 8. Monitoring and Alerting

All services emit structured JSON logs via [pino](https://getpino.io). Each log line includes a `service` field for easy filtering.

### Key log events to alert on

| Service | Log message                                      | Severity | Action                                                                                       |
| ------- | ------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------- |
| Indexer | `Startup gap detected`                           | WARN     | Verify backfill completes; check `BACKFILL_CIRCUIT_BREAKER_MAX_FAILURES`                     |
| Indexer | `backfill_alert` metric                          | WARN     | Gap exceeds `BACKFILL_ALERT_THRESHOLD`; manual intervention may be needed                    |
| Indexer | `Fatal error`                                    | ERROR    | Pod crashed; check DB/RPC connectivity                                                       |
| All     | `REDIS_URL is not set`                           | WARN     | Rate limiting is per-instance; set `REDIS_URL` in multi-replica deployments                  |
| All     | `REDIS_URL is required when NODE_ENV=production` | FATAL    | Service refused to start — set `REDIS_URL` (or `ALLOW_IN_MEMORY_RATE_LIMIT` for one replica) |
| Oracle  | `Attestation submission failed`                  | ERROR    | RPC or signing error; check `SOROBAN_RPC_URL` and the configured `SECRETS` key source        |
| Oracle  | `Rate limit exceeded`                            | WARN     | Potential abuse; review `ORACLE_RATE_LIMIT_MAX_REQUESTS`                                     |

### Recommended metrics (Prometheus / Grafana)

Scrape the `/health/ready` endpoint and expose the following:

- `http_requests_total{service, status_code}` — request throughput and error rate
- `http_request_duration_ms` — latency percentiles (p50, p95, p99)
- `postgres_query_duration_ms` — slow query frequency (logged above `SLOW_QUERY_THRESHOLD_MS`)
- `indexer_lag_ledgers` — difference between latest on-chain ledger and `processed_cursor`
- `backfill_gap_ledgers` — size of any detected backfill gap

### Health check monitoring

Poll `/health/ready` every 30 seconds from an external uptime monitor (e.g. UptimeRobot, Pingdom). Alert if the endpoint returns non-200 for two consecutive checks.

Also poll `/health` and alert on `rateLimiter.shared == false` for any deployment
with more than one replica — the limiter is running per-instance and the
documented limits are not being enforced.

---

## 9. Backup and Recovery

### PostgreSQL

**Indexer database**

The indexer database is **fully re-derivable** by replaying Soroban events from `START_LEDGER`. In practice, restore from a backup to avoid hours of re-indexing:

```bash
# Backup
pg_dump "$DATABASE_URL_INDEXER" | gzip > indexer-$(date +%Y%m%d).sql.gz

# Restore
gunzip -c indexer-<date>.sql.gz | psql "$DATABASE_URL_INDEXER"
```

**DM Relay database**

Messages are ephemeral (TTL controlled by `MESSAGE_TTL_DAYS`) but the idempotency table should be backed up to avoid re-processing of in-flight messages on restore:

```bash
# Backup
pg_dump "$DATABASE_URL_DM" | gzip > dm-relay-$(date +%Y%m%d).sql.gz

# Restore
gunzip -c dm-relay-<date>.sql.gz | psql "$DATABASE_URL_DM"
```

Recommended backup schedule: daily snapshots retained for 7 days, weekly snapshots retained for 4 weeks.

### Indexer recovery after downtime

If the indexer was offline and missed ledgers, it detects the gap automatically on startup and backfills via `BackfillCoordinator`. The maximum auto-backfill depth is controlled by `BACKFILL_MAX_DEPTH_LEDGERS` (default 10 000). For larger gaps:

1. Check the structured log for `Startup gap detected` to see the gap size.
2. Increase `BACKFILL_MAX_DEPTH_LEDGERS` temporarily, restart, and let it backfill.
3. Restore `BACKFILL_MAX_DEPTH_LEDGERS` to the default after recovery.

### Oracle key recovery and rotation

The oracle signing key is a 32-byte Ed25519 seed. It is loaded at startup from a
secret file (see `SECRETS` in the table above) and never passed via an
environment variable in production. If lost, a new key must be registered
on-chain via governance.

**Key rotation without restart:** store the new seed at the `SECRETS` file path
(updating the mounted secret), then call the authenticated admin endpoint:

```
curl -X POST http://<oracle>/admin/rotate-key \
  -H "Authorization: Bearer $ADMIN_SECRET"
```

The service reloads the key atomically, derives the new public key, invalidates
the attestation cache, and continues signing under the new key. The old raw seed
is zeroed on the heap. Then register the new public key on-chain via governance.

**Store the key in a secrets manager** (AWS Secrets Manager, GCP Secret Manager,
HashiCorp Vault) and mount it as a file. Never commit it to source control. The
`ADMIN_SECRET` bearer token must likewise be stored in a secrets manager and
never hard-coded.

### Redis

Redis holds only transient rate-limit state. No backup is required — on restart the counters reset gracefully and services continue operating, losing at most one window of enforcement.

Redis is, however, a **hard startup dependency in production**: services validate `REDIS_URL` before binding a port. Treat it as a required component of the deployment, not an optional cache, and make sure every replica of a service resolves to the same Redis endpoint.

##
