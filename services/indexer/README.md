# Linkora Indexer

Event indexer for the Linkora Social contract on Stellar. Processes on-chain events and maintains a queryable database for the frontend.

## Architecture

The indexer listens to Stellar contract events and processes them into a PostgreSQL database:

```
RPC getEvents → stream (rate-limited, adaptive, gap-aware)
              → IngestPipeline (raw_events + domain write + cursor, one txn)
              → EventBus → WebSocket fanout (/ws)
```

- **Event Handlers**: Process specific event types (PostCreated, TipEvent, LikeEvent, etc.)
- **Database**: PostgreSQL with migrations for schema management
- **Idempotency**: All handlers are idempotent using unique constraints and transaction hashes

### Exactly-once ingestion

Each batch is ingested inside a **single serialisable transaction**:

1. Events are staged into `raw_events` (`ON CONFLICT (ledger_sequence, event_index) DO NOTHING`).
2. They are projected into the domain tables (posts, follows, …) via the same transaction client.
3. `indexer_state.processed_cursor` is advanced — the **last** statement before `COMMIT`.

Because the raw ingest, domain write, and cursor advance commit atomically, a crash
mid-batch rolls everything back. On restart the batch is replayed and the `ON CONFLICT`
clause plus idempotent handlers guarantee **no duplicate domain rows**. See
[`src/pipeline.ts`](src/pipeline.ts).

### Backpressure & adaptive polling

- A **token-bucket rate limiter** caps outbound RPC calls (default 10 req/s,
  `RPC_RATE_LIMIT_PER_SEC`). See [`src/ratelimit.ts`](src/ratelimit.ts).
- The **poll interval adapts** to load: it doubles (up to 5s) when a batch is empty
  and halves (down to 100ms) on a full page. See [`src/poller.ts`](src/poller.ts).
- `429` responses trigger **exponential backoff with retries**; the window is
  re-fetched so no events are dropped.

### Pub/sub fanout

An in-process [`EventBus`](src/bus.ts) (Node `EventEmitter`) lets downstream consumers
subscribe to typed event channels instead of polling the DB. The WebSocket handler
(`/ws`) is the first consumer — see [`docs/indexer/WEBSOCKET_API.md`](../../docs/indexer/WEBSOCKET_API.md).

### Gap detection

After each batch the first event's ledger is compared to `cursor + 1`. A jump (e.g. from
RPC node failover mid-sequence) emits a structured `gap_detected` log and triggers a
**targeted backfill** of the missing range before the batch is processed. See
[`src/gap.ts`](src/gap.ts).

## Event Handlers

### Post Handlers (`src/handlers/post.ts`)

- **PostCreatedEvent**: Inserts new posts into the `posts` table
- **PostDeletedEvent**: Soft deletes posts by setting `deleted_at` timestamp

### Tip Handler (`src/handlers/tip.ts`)

- **TipEvent**: Records tips in `tips` table and increments `tip_total` on posts
- Idempotent via `tx_hash` unique constraint

### Like Handler (`src/handlers/like.ts`)

- **LikePostEvent**: Records likes in `likes` table and increments `like_count` on posts
- Idempotent via `(post_id, user_address)` unique constraint

## Database Schema

### Posts Table

```sql
CREATE TABLE posts (
    id BIGINT PRIMARY KEY,
    author TEXT NOT NULL,
    content TEXT NOT NULL,
    tip_total BIGINT NOT NULL DEFAULT 0,
    like_count BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL,
    deleted_at TIMESTAMP DEFAULT NULL
);
```

### Tips Table

```sql
CREATE TABLE tips (
    id SERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES posts(id),
    tipper TEXT NOT NULL,
    amount BIGINT NOT NULL,
    fee BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    tx_hash TEXT NOT NULL UNIQUE
);
```

### Likes Table

```sql
CREATE TABLE likes (
    id SERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES posts(id),
    user_address TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    tx_hash TEXT NOT NULL UNIQUE,
    UNIQUE (post_id, user_address)
);
```

## Local Setup (Docker)

The fastest way to run the indexer and PostgreSQL together is Docker Compose.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose v2

### Steps

```bash
# 1. Copy and edit environment variables
cp .env.example .env
# Edit .env — set CONTRACT_ID, START_LEDGER, and STELLAR_RPC_URL at minimum

# 2. Start both services (migrations run automatically on first boot)
docker compose up --build
```

The indexer API will be available at `http://localhost:3000`.
PostgreSQL is exposed on port `5432`.

To stop and remove containers:

```bash
docker compose down
```

To also remove the database volume:

```bash
docker compose down -v
```

### Environment Variables

See [`.env.example`](.env.example) for all required variables.

| Variable                 | Description                               |
| ------------------------ | ----------------------------------------- |
| `DATABASE_URL`           | PostgreSQL connection string              |
| `STELLAR_RPC_URL`        | Soroban RPC endpoint                      |
| `CONTRACT_ID`            | Deployed Linkora contract address         |
| `START_LEDGER`           | Ledger sequence to start indexing from    |
| `PORT`                   | HTTP/WS port (default: `3000`)            |
| `RPC_RATE_LIMIT_PER_SEC` | Token-bucket RPC rate cap (default: `10`) |
| `MIN_POLL_INTERVAL_MS`   | Adaptive poll floor (default: `100`)      |
| `MAX_POLL_INTERVAL_MS`   | Adaptive poll ceiling (default: `5000`)   |

## Manual Setup

### Prerequisites

- Node.js 18+
- PostgreSQL 14+

### Installation

```bash
npm install
```

### Database Setup

```bash
# Apply migrations manually
psql "$DATABASE_URL" -f migrations/001_profiles.sql
psql "$DATABASE_URL" -f migrations/002_posts.sql
psql "$DATABASE_URL" -f migrations/003_follows.sql
psql "$DATABASE_URL" -f migrations/004_tips_likes.sql
psql "$DATABASE_URL" -f migrations/005_pools.sql
psql "$DATABASE_URL" -f migrations/006_raw_events.sql
psql "$DATABASE_URL" -f migrations/007_device_tokens.sql
```

### Configuration

```bash
cp .env.example .env
# Edit .env with your values
```

## Running

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- post.test.ts
```

## Idempotency

All event handlers are designed to be idempotent:

1. **PostCreatedEvent**: Uses `ON CONFLICT (id) DO NOTHING`
2. **PostDeletedEvent**: Only updates if `deleted_at IS NULL`
3. **TipEvent**: Uses `tx_hash` unique constraint
4. **LikeEvent**: Uses `(post_id, user_address)` unique constraint

This ensures the indexer can safely replay events without data corruption.

## Monitoring

### Health Check

```bash
curl http://localhost:3000/health
```

### Metrics

- Events processed per second
- Database query latency
- Failed event count
- Current indexed ledger

## Deployment

### Docker

```bash
docker build -t linkora-indexer .
docker run -p 3000:3000 --env-file .env linkora-indexer
```

### Kubernetes

```bash
kubectl apply -f k8s/deployment.yaml
```

## Troubleshooting

### Indexer falls behind

- Check Stellar RPC rate limits
- Increase database connection pool size
- Scale horizontally with multiple indexer instances

### Duplicate events

- Verify idempotency constraints are in place
- Check transaction hash uniqueness
- Review event replay logic

### Missing events

- Verify START_LEDGER is correct
- Check Stellar RPC connectivity
- Review event filter configuration

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.

## License

MIT
