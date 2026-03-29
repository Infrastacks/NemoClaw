# Pre-built Go transform proxies (cross-compiled for linux/amd64 on host)
# To rebuild: CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o <binary> .
# Original multi-stage Go builds removed to avoid QEMU crashes on ARM Macs.
#
# Pre-built Node.js telemetry agent (from codicera/agent, compiled on host)
# To rebuild: cd codicera/agent && npx tsc && copy dist/*.js + node_modules/ws to deploy/prebuilt-agent/
#
# Pre-built OpenShell sandbox binary (Rust, cross-compiled for x86_64-unknown-linux-musl)
# To rebuild: see OpenShell repo, cargo build --release -p openshell-sandbox --target x86_64-unknown-linux-musl

FROM python:3.12-alpine AS runtime
RUN apk add --no-cache curl git ca-certificates nodejs

# Add sandbox user (required by OpenShell process.run_as_user policy)
RUN adduser -D -H -s /sbin/nologin sandbox

# Install CAR from local source (or private repo via BuildKit secret)
COPY car/ /opt/car-src/
RUN apk add --no-cache --virtual .build-deps build-base postgresql-dev \
    && pip install --no-cache-dir "/opt/car-src/[autogen,langgraph]" pyyaml \
    && apk del .build-deps \
    && apk add --no-cache libpq

# Pre-built Go transform proxy binaries
COPY deploy/prebuilt/ncp-transform-proxy /usr/local/bin/ncp-transform-proxy
COPY deploy/prebuilt/azure-transform-proxy /usr/local/bin/azure-transform-proxy
RUN chmod +x /usr/local/bin/ncp-transform-proxy /usr/local/bin/azure-transform-proxy

# Pre-built OpenShell sandbox binary (CONNECT proxy + L7 inspection)
# Replaces the standalone pii-policy-proxy — PII detection now happens
# in the L7 pipeline alongside supply chain scanning.
COPY deploy/prebuilt/openshell /usr/local/bin/openshell
RUN chmod +x /usr/local/bin/openshell

# OPA Rego rules + base policy YAML for OpenShell
RUN mkdir -p /opt/openshell /etc/openshell-tls
COPY deploy/rego/sandbox-policy.rego /opt/openshell/sandbox-policy.rego
COPY nemoclaw-blueprint/policies/openclaw-sandbox.yaml /opt/openshell/nemoclaw-policy.yaml

# OpenShell restart helper (called by agent for policy hot-reload)
COPY deploy/restart-openshell.sh /usr/local/bin/restart-openshell.sh
RUN chmod +x /usr/local/bin/restart-openshell.sh

# Pre-built telemetry agent (Codicera agent with heartbeat + log forwarding)
COPY deploy/prebuilt-agent/ /opt/agent/

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
