# Runs the DM relay straight from TypeScript sources with tsx (the same way
# migrations and local dev run), because @linkora/types exposes raw .ts source
# that cannot be consumed by plain `node dist`.
FROM node:20-alpine

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable && apk add --no-cache curl

WORKDIR /app

# All workspace manifests are copied so the frozen lockfile check passes;
# only the relay and its workspace deps get actually installed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/mobile/package.json apps/mobile/
COPY apps/web/package.json apps/web/
COPY packages/codegen/package.json packages/codegen/
COPY packages/contracts/package.json packages/contracts/
COPY packages/sdk/package.json packages/sdk/
COPY packages/types/package.json packages/types/
COPY services/analytics-oracle/package.json services/analytics-oracle/
COPY services/dm-relay/package.json services/dm-relay/
COPY services/indexer/package.json services/indexer/

RUN pnpm install --frozen-lockfile --filter "linkora-dm-relay..."

COPY packages/types ./packages/types
COPY services/dm-relay ./services/dm-relay

RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup && \
    chown -R appuser:appgroup /app

USER appuser
WORKDIR /app/services/dm-relay

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=30s \
  CMD curl -f http://localhost:3001/health/ready || exit 1

CMD ["node_modules/.bin/tsx", "src/server.ts"]
