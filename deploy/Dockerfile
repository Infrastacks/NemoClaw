# Pre-built Go transform proxies (cross-compiled for linux/amd64 on host)
# To rebuild: CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o <binary> .
# Original multi-stage Go builds removed to avoid QEMU crashes on ARM Macs.

# Stage 1: Build telemetry agent
FROM node:22-alpine AS builder
WORKDIR /build
COPY agent/package.json agent/package-lock.json ./
RUN npm ci
COPY agent/ .
RUN npm run build

# Stage 2: Runtime — CAR Agent API + telemetry agent
FROM python:3.12-alpine AS runtime
RUN apk add --no-cache curl git ca-certificates nodejs

# Install CAR from local source (or private repo via BuildKit secret)
COPY car/ /opt/car-src/
RUN apk add --no-cache --virtual .build-deps build-base postgresql-dev \
    && pip install --no-cache-dir /opt/car-src/ \
    && apk del .build-deps \
    && apk add --no-cache libpq

# Pre-built Go transform proxy binaries
COPY deploy/prebuilt/ncp-transform-proxy /usr/local/bin/ncp-transform-proxy
COPY deploy/prebuilt/azure-transform-proxy /usr/local/bin/azure-transform-proxy
RUN chmod +x /usr/local/bin/ncp-transform-proxy /usr/local/bin/azure-transform-proxy

# Copy built telemetry agent and production dependencies
COPY --from=builder /build/dist /opt/agent/
COPY --from=builder /build/node_modules /opt/agent/node_modules/

# Create state directory for CAR SQLite checkpointer
RUN mkdir -p /var/lib/car /sandbox/.nemoclaw

# Entrypoint
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /opt

# CAR Agent API
EXPOSE 18800

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:18800/v1/agent/status || exit 1

ENTRYPOINT ["/entrypoint.sh"]
