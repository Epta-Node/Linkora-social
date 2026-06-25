# Indexer security hardening TODO

- [x] Implement Redis-backed sliding-window rate limiting with in-memory fallback (services/indexer/src/middleware/rateLimit.ts)
  - [ ] Enforce 60 req/min per IP for read endpoints
  - [ ] Enforce 10 req/min per authenticated stellarAddress for write endpoints
  - [ ] 429 + Retry-After header on limit exceeded
  - [ ] Keep existing abuse tracking compatibility

- [ ] Apply Stellar signature authentication middleware to all write endpoints (services/indexer/src/api/index.ts)
  - [ ] Protect POST /api/search/posts
  - [ ] Ensure req.context.stellarAddress is set for downstream

- [ ] Replace remaining console.\* with pino logger
  - [ ] services/indexer/src/api/index.ts error handler
  - [ ] services/indexer/src/index.ts bootstrap/shutdown + fatal error

- [ ] Add GET /health endpoint and wire connectivity flags
  - [ ] services/indexer/src/logger.ts healthState plumbing
  - [ ] services/indexer/src/api/index.ts GET /health
  - [ ] services/indexer/src/index.ts / stream.ts to set rpcConnected + dbConnected

- [ ] Add/extend Jest tests
  - [ ] Rate limit burst: 70 reads => 61st returns 429 and has Retry-After
  - [ ] Stellar auth: valid write accepted
  - [ ] Stellar auth: 60s old timestamp => 403
  - [ ] Stellar auth: invalid signature => 401

- [ ] Run tests: `cd services/indexer && npm test`
