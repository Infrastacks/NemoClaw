#!/bin/sh
set -e

echo "Starting NemoClaw runtime..."

# Ensure event log directory exists
mkdir -p /root/.nemoclaw

# ── Configure and start OpenClaw gateway ──────────────────────────

# Override hostname — K8s pod names exceed the 63-byte mDNS label limit
hostname "${SANDBOX_ID:-openclaw}" 2>/dev/null || true
export HOSTNAME="${SANDBOX_ID:-openclaw}"

node /app/configure-gateway.js

# Register NemoClaw plugin (best-effort — gateway works without it)
# NOTE: skip 'openclaw doctor --fix' — it overwrites allowedOrigins config
openclaw plugins install /opt/nemoclaw > /dev/null 2>&1 || true

# Patch gateway config — plugins install may add token auth that blocks proxy access
node -e '
const fs = require("fs"), p = require("os").homedir() + "/.openclaw/openclaw.json";
const c = JSON.parse(fs.readFileSync(p, "utf8"));
c.gateway.auth = { mode: "trusted-proxy", trustedProxy: { userHeader: "X-Forwarded-User" } };
c.gateway.controlUi = c.gateway.controlUi || {};
c.gateway.controlUi.allowInsecureAuth = true;
c.gateway.controlUi.dangerouslyDisableDeviceAuth = true;
c.gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback = true;
c.gateway.controlUi.allowedOrigins = ["https://api.codicera.com","https://codicera-api-production.infrastacks.workers.dev","http://localhost:18789","http://127.0.0.1:18789"];
fs.writeFileSync(p, JSON.stringify(c, null, 2), { mode: 0o600 });
console.log("[configure] patched gateway config (post-plugins)");
'

# Start gateway (serves web UI + inference API on localhost:18789)
openclaw gateway run > /tmp/gateway.log 2>&1 &
GATEWAY_PID=$!
echo "OpenClaw gateway started (pid $GATEWAY_PID)"

# Wait for gateway to be ready (max 15s)
TRIES=0
while [ $TRIES -lt 30 ]; do
  if curl -sf http://localhost:18789/health > /dev/null 2>&1; then
    echo "Gateway healthy on localhost:18789"
    break
  fi
  TRIES=$((TRIES + 1))
  sleep 0.5
done

if [ $TRIES -ge 30 ]; then
  echo "WARNING: gateway did not become healthy within 15s"
  echo "--- gateway log ---"
  cat /tmp/gateway.log 2>/dev/null || true
  echo "---"
fi

# TCP proxy: OpenClaw only binds localhost, but K8s Service needs 0.0.0.0.
# Proxy on :18800 exposes the gateway to the cluster network.
PROXY_LISTEN_PORT=18800 PROXY_TARGET_PORT=18789 /usr/local/bin/tcp-proxy &
PROXY_PID=$!

# ── Start telemetry agent ─────────────────────────────────────────

# Build WebSocket URL from CODICERA_ENDPOINT
WS_URL="${CODICERA_ENDPOINT:-http://localhost:8080}"
# Convert https:// to wss://
WS_URL=$(echo "$WS_URL" | sed 's|^https://|wss://|;s|^http://|ws://|')
WS_URL="${WS_URL}/ws?channel=telemetry&sandboxId=${SANDBOX_ID:-unknown}"

echo "Connecting agent to: $WS_URL"

cd /app
node agent/cli.js --ws-url "$WS_URL" &
AGENT_PID=$!

# Write a startup heartbeat event AFTER the agent starts (tailer seeks to EOF).
# The delay ensures the EventTailer is watching before we write.
(sleep 3 && echo "{\"eventType\":\"agent.heartbeat\",\"sandboxId\":\"${SANDBOX_ID:-unknown}\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"data\":{}}" >> /root/.nemoclaw/events.jsonl) &

# ── Signal handling ───────────────────────────────────────────────

cleanup() {
  echo "Shutting down..."
  kill $GATEWAY_PID $PROXY_PID $AGENT_PID 2>/dev/null || true
  wait $GATEWAY_PID $PROXY_PID $AGENT_PID 2>/dev/null || true
  exit 0
}
trap cleanup TERM INT

# Keep container alive as long as the gateway is running.
# The agent is telemetry — its failure shouldn't crash the pod.
echo "All services running (gateway=$GATEWAY_PID, proxy=$PROXY_PID, agent=$AGENT_PID)"
while kill -0 $GATEWAY_PID 2>/dev/null; do
  sleep 2
done
echo "Gateway exited, shutting down"
cleanup
