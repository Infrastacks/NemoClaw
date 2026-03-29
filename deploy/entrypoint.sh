#!/bin/sh
set -e

echo "Starting NemoClaw runtime (v3 — OpenShell CONNECT proxy)..."

# Ensure directories exist
mkdir -p /sandbox/.nemoclaw
mkdir -p /var/lib/car
mkdir -p /root/.nemoclaw
mkdir -p /var/run

# Container log file — tailed by agent sidecar for Live Logs in the console
LOG_FILE="/sandbox/.nemoclaw/container.log"
touch "$LOG_FILE"
ln -sf /sandbox/.nemoclaw/events.jsonl /root/.nemoclaw/events.jsonl

# Override hostname — K8s pod names exceed the 63-byte mDNS label limit
hostname "${SANDBOX_ID:-nemoclaw}" 2>/dev/null || true
export HOSTNAME="${SANDBOX_ID:-nemoclaw}"

# ── Assemble OpenShell policy from CODICERA_POLICIES ─────────────
# Merges base policy with dynamic policies from the backend.
# - Network policies → merge into network_policies section
# - PII policies → replace pii section
# - Supply chain → write to separate file (per-tunnel hot-reload)
# Output: /sandbox/.nemoclaw/sandbox-policy.yaml

# Copy base policy as starting point
cp /opt/openshell/nemoclaw-policy.yaml /sandbox/.nemoclaw/sandbox-policy.yaml

if [ -n "${CODICERA_POLICIES:-}" ]; then
  echo "Assembling policies from CODICERA_POLICIES..."
  echo "$CODICERA_POLICIES" | base64 -d | python3 -c "
import json, sys, os
try:
    import yaml
except ImportError:
    yaml = None

policies = json.load(sys.stdin)

# Load the base policy
with open('/sandbox/.nemoclaw/sandbox-policy.yaml', 'r') as f:
    if yaml:
        base = yaml.safe_load(f)
    else:
        # Fallback: just use base as-is, skip merging
        print('WARNING: PyYAML not available, skipping policy assembly')
        sys.exit(0)

if base is None:
    base = {}
if 'network_policies' not in base:
    base['network_policies'] = {}

applied = 0
failed = 0
for p in policies:
    try:
        ptype = p.get('type', 'network')
        spec = p.get('spec', {})

        if ptype == 'pii':
            # PII: replace pii section in base policy
            base['pii'] = spec
            print(f'Policy {p[\"name\"]}: merged pii config')

        elif ptype == 'supply_chain':
            # Supply chain: write to separate file (OpenShell reads per-tunnel)
            sc_data = {'version': 1, 'supply_chain': spec}
            sc_path = os.environ.get('SUPPLY_CHAIN_POLICY_PATH',
                                     '/sandbox/.nemoclaw/supply-chain-policy.yaml')
            tmp = sc_path + '.tmp'
            with open(tmp, 'w') as f:
                yaml.dump(sc_data, f, default_flow_style=False)
            os.rename(tmp, sc_path)
            print(f'Policy {p[\"name\"]}: wrote supply chain to {sc_path}')

        else:
            # Network / filesystem / other: merge into base
            if 'network_policies' in spec:
                base['network_policies'].update(spec['network_policies'])
            elif 'endpoints' in spec:
                base['network_policies'][p['name']] = spec
            # Also merge filesystem_policy if present
            if 'filesystem_policy' in spec:
                base['filesystem_policy'] = spec['filesystem_policy']
            print(f'Policy {p[\"name\"]}: merged into base')

        applied += 1
    except Exception as e:
        failed += 1
        print(f'Policy {p[\"name\"]}: error ({e})')

# Write assembled policy
tmp = '/sandbox/.nemoclaw/sandbox-policy.yaml.tmp'
with open(tmp, 'w') as f:
    yaml.dump(base, f, default_flow_style=False)
os.rename(tmp, '/sandbox/.nemoclaw/sandbox-policy.yaml')
print(f'Policies: {applied} applied, {failed} failed')

# Also write JSON sidecar for agent hot-reload (avoids YAML parsing in Node.js)
with open('/sandbox/.nemoclaw/sandbox-policy.json', 'w') as f:
    json.dump(base, f)
" 2>&1
fi

# Ensure JSON sidecar exists (for base-only case when CODICERA_POLICIES is empty)
if [ ! -f /sandbox/.nemoclaw/sandbox-policy.json ]; then
  python3 -c "
import yaml, json
with open('/sandbox/.nemoclaw/sandbox-policy.yaml') as f:
    data = yaml.safe_load(f) or {}
with open('/sandbox/.nemoclaw/sandbox-policy.json', 'w') as f:
    json.dump(data, f)
"
fi

# ── Start OpenShell CONNECT proxy ────────────────────────────────
# L7 inspection: supply chain scanning + PII detection on ALL egress.
# Listens on 127.0.0.1:3128 (CONNECT proxy).
# Health check on :3129.
echo "[entrypoint] Starting OpenShell CONNECT proxy..."

/usr/local/bin/openshell \
  --policy-rules /opt/openshell/sandbox-policy.rego \
  --policy-data /sandbox/.nemoclaw/sandbox-policy.yaml \
  --health-check \
  --health-port 3129 \
  --log-level info \
  -- sleep infinity 2>&1 | tee -a "$LOG_FILE" &
OPENSHELL_PID=$!
echo "$OPENSHELL_PID" > /var/run/openshell.pid
echo "[entrypoint] OpenShell started (pid $OPENSHELL_PID)"

# Wait for CA cert generation + proxy health (max 15s)
OPENSHELL_TRIES=0
while [ $OPENSHELL_TRIES -lt 30 ]; do
  if [ -f /etc/openshell-tls/ca-bundle.pem ] && \
     curl -sf http://127.0.0.1:3129/healthz > /dev/null 2>&1; then
    echo "[entrypoint] OpenShell CONNECT proxy healthy on 127.0.0.1:3128"
    break
  fi
  OPENSHELL_TRIES=$((OPENSHELL_TRIES + 1))
  sleep 0.5
done

if [ $OPENSHELL_TRIES -ge 30 ]; then
  echo "FATAL: OpenShell CONNECT proxy did not become healthy within 15s" >&2
  kill $OPENSHELL_PID 2>/dev/null || true
  exit 1
fi

# ── Export TLS trust for downstream services ─────────────────────
# OpenShell generates an ephemeral CA for TLS MITM inspection.
# These env vars make all downstream HTTP clients (Go, Python, Node.js,
# curl) trust the MITM certificates.
export NODE_EXTRA_CA_CERTS="/etc/openshell-tls/openshell-ca.pem"
export SSL_CERT_FILE="/etc/openshell-tls/ca-bundle.pem"
export REQUESTS_CA_BUNDLE="/etc/openshell-tls/ca-bundle.pem"
export CURL_CA_BUNDLE="/etc/openshell-tls/ca-bundle.pem"

# ── Export HTTP proxy for all outbound traffic ───────────────────
# All outbound HTTPS goes through OpenShell for L7 inspection.
# NO_PROXY excludes local service-to-service traffic.
export HTTP_PROXY="http://127.0.0.1:3128"
export HTTPS_PROXY="http://127.0.0.1:3128"
export http_proxy="http://127.0.0.1:3128"
export https_proxy="http://127.0.0.1:3128"
export NO_PROXY="127.0.0.1,localhost,::1"
export no_proxy="127.0.0.1,localhost,::1"

# ── Start inference transform proxy ───────────────────────────────
# Each provider has its own proxy that rewrites requests for API compatibility.
# Outbound calls from the transform proxy go through OpenShell via HTTP_PROXY.
PROVIDER_TYPE="${INFERENCE_PROVIDER_TYPE:-ncp}"
INFERENCE_PROXY_PID=""

if [ "$PROVIDER_TYPE" = "azure" ]; then
  # Azure AI Foundry: auth conversion (Bearer→api-key) + URL rewriting
  export AZURE_UPSTREAM="${INFERENCE_ENDPOINT:-https://localhost}"
  AZURE_PROXY_PORT=9001 /usr/local/bin/azure-transform-proxy 2>&1 | tee -a "$LOG_FILE" &
  INFERENCE_PROXY_PID=$!
  echo "Azure transform proxy started (pid $INFERENCE_PROXY_PID)"
  HEALTH_PORT=9001
else
  # NVIDIA NCP: content array flattening, strict stripping, max_completion_tokens rename
  _raw="${INFERENCE_ENDPOINT:-https://integrate.api.nvidia.com/v1}"
  export NCP_UPSTREAM="${_raw%/v1}"
  NCP_PROXY_PORT=9000 /usr/local/bin/ncp-transform-proxy 2>&1 | tee -a "$LOG_FILE" &
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
# Inference goes to the transform proxy directly (PII is checked by
# OpenShell when the transform proxy's outbound request hits the
# CONNECT proxy).
export CAR_DB_PATH="/var/lib/car/state.db"
export INFERENCE_URL="${INFERENCE_URL:-http://127.0.0.1:${HEALTH_PORT}/v1/chat/completions}"
export INFERENCE_MODEL="${INFERENCE_MODEL:-${NEMOCLAW_MODEL:-default}}"
export INFERENCE_API_KEY="${INFERENCE_API_KEY:-${AZURE_OPENAI_API_KEY:-${NVIDIA_API_KEY:-${OPENAI_API_KEY:-}}}}"

python3 -m uvicorn server.app:app --host 0.0.0.0 --port 18800 --log-level info 2>&1 | tee -a "$LOG_FILE" &
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

# Build base WebSocket URL — the agent appends query params itself
AGENT_WS="${CODICERA_ENDPOINT:-http://localhost:8080}"
AGENT_WS=$(echo "$AGENT_WS" | sed 's|^https://|wss://|;s|^http://|ws://|')
AGENT_WS="${AGENT_WS}/ws"

echo "Connecting agent to: $AGENT_WS (sandbox: ${SANDBOX_ID:-unknown})"

node /opt/agent/index.js \
  --sandbox-id "${SANDBOX_ID:-unknown}" \
  --api-url "$AGENT_WS" \
  --events-path /sandbox/.nemoclaw/events.jsonl &
AGENT_PID=$!

# Write a startup heartbeat event AFTER the agent starts (tailer seeks to EOF).
(sleep 3 && echo "{\"eventType\":\"agent.heartbeat\",\"sandboxId\":\"${SANDBOX_ID:-unknown}\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"data\":{}}" >> /sandbox/.nemoclaw/events.jsonl) &

# ── Signal handling ───────────────────────────────────────────────

cleanup() {
  echo "Shutting down..."
  kill $CAR_PID $INFERENCE_PROXY_PID $OPENSHELL_PID $AGENT_PID 2>/dev/null || true
  wait $CAR_PID $INFERENCE_PROXY_PID $OPENSHELL_PID $AGENT_PID 2>/dev/null || true
  exit 0
}
trap cleanup TERM INT

# Keep container alive as long as the Agent API server is running.
echo "All services running (car=$CAR_PID, inference-proxy=$INFERENCE_PROXY_PID, openshell=$OPENSHELL_PID, agent=$AGENT_PID)"
while kill -0 $CAR_PID 2>/dev/null; do
  sleep 2
done
echo "CAR Agent API exited, shutting down"
cleanup
