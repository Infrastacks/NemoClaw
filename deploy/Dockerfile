# Stage 1: Build agent
FROM node:22-alpine AS builder
WORKDIR /build
COPY agent/package.json agent/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY agent/ .
RUN pnpm build

# Stage 2: Runtime
FROM node:22-alpine AS runtime
RUN apk add --no-cache curl

WORKDIR /app

# Copy NemoClaw runtime (pre-built or mounted)
COPY --from=builder /build/dist ./agent/

# Agent entrypoint
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# NemoClaw ports
EXPOSE 18789
# Agent metrics
EXPOSE 18790

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:18789/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
