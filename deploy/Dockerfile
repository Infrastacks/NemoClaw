# Stage 0: Build Go TCP proxy
FROM golang:1.24-alpine AS go-builder
WORKDIR /build
COPY deploy/tcp-proxy/ .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o tcp-proxy .

# Stage 1: Build agent
FROM node:22-alpine AS builder
WORKDIR /build
COPY agent/package.json agent/package-lock.json ./
RUN npm ci
COPY agent/ .
RUN npm run build

# Stage 2: Runtime — OpenClaw gateway + telemetry agent
# Use slim (Debian) instead of Alpine: OpenClaw's node-llama-cpp needs glibc
FROM --platform=linux/amd64 node:22-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install OpenClaw CLI (provides the gateway server on port 18789)
# --ignore-scripts: skip node-llama-cpp native build — we use external NCP inference, not local
RUN npm install -g --ignore-scripts openclaw@2026.3.11

# Copy NemoClaw plugin
COPY nemoclaw/dist/ /opt/nemoclaw/dist/
COPY nemoclaw/openclaw.plugin.json /opt/nemoclaw/
COPY nemoclaw/package.json /opt/nemoclaw/
WORKDIR /opt/nemoclaw
RUN npm install --omit=dev
WORKDIR /app

# Pre-create OpenClaw directories
RUN mkdir -p /root/.openclaw/agents/main/agent \
    && chmod 700 /root/.openclaw

# Gateway configuration script
COPY deploy/configure-gateway.js ./configure-gateway.js

# Go TCP proxy binary
COPY --from=go-builder /build/tcp-proxy /usr/local/bin/tcp-proxy

# Copy built agent and production dependencies
COPY --from=builder /build/dist ./agent/
COPY --from=builder /build/node_modules ./agent/node_modules/

# Entrypoint
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# OpenClaw gateway (localhost:18789) exposed via TCP proxy on 0.0.0.0:18800
EXPOSE 18800
# Agent metrics
EXPOSE 18790

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:18789/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
