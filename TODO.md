# TODO — Linkora-social indexer Phase 1-3

## Step 1 — Postgres DB implementation + follow_counts materialization

- [x] Inspect current DB expectations vs migrations (posts/follows/tips/likes/pools)
- [x] Install deps + run existing indexer test suite (all 57 handler tests passing)
- [x] Create `services/indexer/src/postgres-db.ts` implementing `Database`

- [ ] Update migrations to add `follow_counts` table
- [ ] Add triggers to keep `follow_counts` consistent on follows insert/delete

## Step 2 — Wire streaming dispatcher

- [ ] Update `services/indexer/src/index.ts` to dispatch events by `event.topic[0]`
- [ ] Map follow/unfollow and post/like/tip topics to existing handlers
- [ ] Ensure idempotency and transaction boundaries as needed

## Step 3 — Social API endpoints

- [ ] Add `/api/social/followers/:address` and `/api/social/following/:address` routes
- [ ] Implement offset/limit pagination backed by materialized follows/follow_counts

## Step 4 — Feed endpoints

- [ ] Add `/api/feed/following` using keyset pagination
- [ ] Add `/api/feed/explore` score computation backing + keyset pagination
- [ ] Implement background job refresh every 60 seconds

## Step 5 — Tests + OpenAPI

- [ ] Add tests for follow graph + counts atomically updated
- [ ] Add tests for following feed correctness
- [ ] Add tests for explore scoring order
- [ ] Add tests for keyset pagination no duplicates under concurrent inserts
- [ ] Update `services/indexer/openapi.yaml` and relevant API docs

## Step 6 — Verify

- [ ] Run indexer test suite
- [ ] Run integration/e2e tests if available
