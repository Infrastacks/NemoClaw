# NemoClaw sandbox image — CAR Agent Runtime + NemoClaw orchestrator inside OpenShell
#
# v2.0.0-alpha: Replaces OpenClaw gateway with Codicera Agent Runtime (CAR).
# CAR serves the Agent API on :18800 (REST/SSE). OpenClaw is removed entirely.

FROM node:22-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pip python3-venv \
        curl git ca-certificates \
        iproute2 \
    && rm -rf /var/lib/apt/lists/*

# Create sandbox user (matches OpenShell convention)
RUN groupadd -r sandbox && useradd -r -g sandbox -d /sandbox -s /bin/bash sandbox \
    && mkdir -p /sandbox/.nemoclaw \
    && chown -R sandbox:sandbox /sandbox

# Install Python dependencies for CAR + blueprint runner
RUN pip3 install --break-system-packages \
    pyyaml \
    fastapi \
    "uvicorn[standard]" \
    httpx \
    aiosqlite

# Copy blueprint into the sandbox
COPY nemoclaw-blueprint/ /opt/nemoclaw-blueprint/

# Copy telemetry agent (Node.js sidecar)
COPY agent/ /opt/agent/
COPY nemoclaw/dist/ /opt/nemoclaw/dist/
COPY nemoclaw/package.json /opt/nemoclaw/

# Install telemetry agent runtime dependencies
WORKDIR /opt/nemoclaw
RUN npm install --omit=dev

# Set up blueprint for local resolution
RUN mkdir -p /sandbox/.nemoclaw/blueprints/0.1.0 \
    && cp -r /opt/nemoclaw-blueprint/* /sandbox/.nemoclaw/blueprints/0.1.0/

# Copy CAR (Codicera Agent Runtime) — commercial IP, ships inside container
COPY car/ /opt/car/

# Create CAR state directory (SQLite checkpoint data persists via PVC)
RUN mkdir -p /var/lib/car && chown sandbox:sandbox /var/lib/car

# Copy entrypoint
COPY deploy/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /sandbox
USER sandbox

# Agent API server on :18800 (replaces OpenClaw gateway on :18789)
EXPOSE 18800
# NemoClaw orchestrator on :18790
EXPOSE 18790

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:18800/v1/agent/status || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
