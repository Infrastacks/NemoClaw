#!/bin/sh
set -e

echo "Starting NemoClaw runtime (v2 — CAR Agent API)..."

# Ensure directories exist
mkdir -p /sandbox/.nemoclaw
mkdir -p /var/lib/car
mkdir -p /root/.nemoclaw
ln -sf /sandbox/.nemoclaw/events.jsonl /root/.nemoclaw/events.jsonl

# Override hostname — K8s pod names exceed the 63-byte mDNS label limit
hostname "${SANDBOX_ID:-nemoclaw}" 2>/dev/null || true
export HOSTNAME="${SANDBOX_ID:-nemoclaw}"

# ── Start inference transform proxy ───────────────────────────────
# Each provider has its own proxy that rewrites requests for API compatibility.
PROVIDER_TYPE="${INFERENCE_PROVIDER_TYPE:-ncp}"
INFERENCE_PROXY_PID=""

if [ "$PROVIDER_TYPE" = "azure" ]; then
  # Azure AI Foundry: auth conversion (Bearer→api-key) + URL rewriting
  export AZURE_UPSTREAM="${INFERENCE_ENDPOINT:-https://localhost}"
  AZURE_PROXY_PORT=9001 /usr/local/bin/azure-transform-proxy &
  INFERENCE_PROXY_PID=$!
  echo "Azure transform proxy started (pid $INFERENCE_PROXY_PID)"
  HEALTH_PORT=9001
else
  # NVIDIA NCP: content array flattening, strict stripping, max_completion_tokens rename
  _raw="${INFERENCE_ENDPOINT:-https://integrate.api.nvidia.com/v1}"
  export NCP_UPSTREAM="${_raw%/v1}"
  NCP_PROXY_PORT=9000 /usr/local/bin/ncp-transform-proxy &
  INFERENCE_PROXY_PID=$!
  echo "NCP transform proxy started (pid $INFERENCE_PROXY_PID)"
  HEALTH_PORT=9000
fi

# Wait for proxy health (max 3s)
PROXY_TRIES=0
while [ $PROXY_TRIES -lt 6 ]; do
  if curl -sf "http://127.0.0.1:${HEALTH_PORT}/healthz" > /dev/null 2>&1; then
    echo "Inference proxy healthy on 127.0.0.1:${HEALTH_PORT}"
    break
  fi
  PROXY_TRIES=$((PROXY_TRIES + 1))
  sleep 0.5
done

# ── Start CAR Agent API server ────────────────────────────────────
# Replaces OpenClaw gateway. Serves REST/SSE on :18800.
export CAR_DB_PATH="/var/lib/car/state.db"
export INFERENCE_URL="${INFERENCE_URL:-http://127.0.0.1:${HEALTH_PORT}/v1/chat/completions}"
export INFERENCE_MODEL="${INFERENCE_MODEL:-${NEMOCLAW_MODEL:-default}}"
export INFERENCE_API_KEY="${INFERENCE_API_KEY:-${NVIDIA_API_KEY:-}}"

python3 -m uvicorn server.app:app --host 0.0.0.0 --port 18800 --log-level info &
CAR_PID=$!
echo "CAR Agent API server started (pid $CAR_PID) on :18800"

# Wait for CAR to be ready (max 10s)
CAR_TRIES=0
while [ $CAR_TRIES -lt 20 ]; do
  if curl -sf http://localhost:18800/v1/agent/status > /dev/null 2>&1; then
    echo "CAR Agent API healthy on localhost:18800"
    break
  fi
  CAR_TRIES=$((CAR_TRIES + 1))
  sleep 0.5
done

if [ $CAR_TRIES -ge 20 ]; then
  echo "WARNING: CAR Agent API did not become healthy within 10s"
fi

# ── Start telemetry agent ─────────────────────────────────────────

# Build WebSocket URL from CODICERA_ENDPOINT
WS_URL="${CODICERA_ENDPOINT:-http://localhost:8080}"
# Convert https:// to wss://
WS_URL=$(echo "$WS_URL" | sed 's|^https://|wss://|;s|^http://|ws://|')
WS_URL="${WS_URL}/ws?channel=telemetry&sandboxId=${SANDBOX_ID:-unknown}"

echo "Connecting agent to: $WS_URL"

node /opt/agent/cli.js --ws-url "$WS_URL" &
AGENT_PID=$!

# Write a startup heartbeat event AFTER the agent starts (tailer seeks to EOF).
(sleep 3 && echo "{\"eventType\":\"agent.heartbeat\",\"sandboxId\":\"${SANDBOX_ID:-unknown}\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"data\":{}}" >> /sandbox/.nemoclaw/events.jsonl) &

# ── Signal handling ───────────────────────────────────────────────

cleanup() {
  echo "Shutting down..."
  kill $CAR_PID $INFERENCE_PROXY_PID $AGENT_PID 2>/dev/null || true
  wait $CAR_PID $INFERENCE_PROXY_PID $AGENT_PID 2>/dev/null || true
  exit 0
}
trap cleanup TERM INT

# Keep container alive as long as the Agent API server is running.
echo "All services running (car=$CAR_PID, inference-proxy=$INFERENCE_PROXY_PID, agent=$AGENT_PID)"
while kill -0 $CAR_PID 2>/dev/null; do
  sleep 2
done
echo "CAR Agent API exited, shutting down"
cleanup
