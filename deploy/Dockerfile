# Stage 0a: Build Go NCP transform proxy
FROM golang:1.24-alpine AS ncp-proxy-builder
WORKDIR /build
COPY deploy/ncp-transform-proxy/ .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o ncp-transform-proxy .

# Stage 0b: Build Go Azure transform proxy
FROM golang:1.24-alpine AS azure-proxy-builder
WORKDIR /build
COPY deploy/azure-transform-proxy/ .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o azure-transform-proxy .

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

# Install CAR Python dependencies (build-base needed for uvloop C extension)
COPY car/pyproject.toml /opt/car/pyproject.toml
WORKDIR /opt/car
RUN apk add --no-cache --virtual .build-deps build-base \
    && pip install --no-cache-dir . \
    && apk del .build-deps

# Copy CAR source
COPY car/ /opt/car/

# Go NCP transform proxy binary
COPY --from=ncp-proxy-builder /build/ncp-transform-proxy /usr/local/bin/ncp-transform-proxy

# Go Azure transform proxy binary
COPY --from=azure-proxy-builder /build/azure-transform-proxy /usr/local/bin/azure-transform-proxy

# Copy built telemetry agent and production dependencies
COPY --from=builder /build/dist /opt/agent/
COPY --from=builder /build/node_modules /opt/agent/node_modules/

# Create state directory for CAR SQLite checkpointer
RUN mkdir -p /var/lib/car /sandbox/.nemoclaw

# Entrypoint
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /opt/car

# CAR Agent API
EXPOSE 18800

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:18800/v1/agent/status || exit 1

ENTRYPOINT ["/entrypoint.sh"]
