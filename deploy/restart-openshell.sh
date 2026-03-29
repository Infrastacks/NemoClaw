#!/bin/sh
# restart-openshell.sh — kill and restart the OpenShell CONNECT proxy.
# Called by the Codicera agent after PII or network policy updates
# (supply chain policies auto-reload per tunnel, no restart needed).
set -e

PID_FILE="/var/run/openshell.pid"
LOG_FILE="/sandbox/.nemoclaw/container.log"

# ── Graceful shutdown of existing proxy ──────────────────────────
PID=$(cat "$PID_FILE" 2>/dev/null)
if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
  echo "[restart-openshell] Stopping OpenShell (pid $PID)..." | tee -a "$LOG_FILE"
  kill "$PID" 2>/dev/null
  # Wait up to 5s for graceful exit
  TRIES=0
  while [ $TRIES -lt 10 ]; do
    kill -0 "$PID" 2>/dev/null || break
    TRIES=$((TRIES + 1))
    sleep 0.5
  done
  # Force kill if still alive
  if kill -0 "$PID" 2>/dev/null; then
    kill -9 "$PID" 2>/dev/null || true
    sleep 0.5
  fi
fi

# ── Start fresh proxy instance ───────────────────────────────────
echo "[restart-openshell] Starting OpenShell CONNECT proxy..." | tee -a "$LOG_FILE"

OPENSHELL_NO_NETNS=1 /usr/local/bin/openshell \
  --policy-rules /opt/openshell/sandbox-policy.rego \
  --policy-data /sandbox/.nemoclaw/sandbox-policy.yaml \
  --health-check \
  --health-port 3129 \
  --log-level info \
  -- sleep infinity 2>&1 | tee -a "$LOG_FILE" &

echo $! > "$PID_FILE"
echo "[restart-openshell] OpenShell restarted (pid $(cat "$PID_FILE"))" | tee -a "$LOG_FILE"

# Wait for health (max 5s)
TRIES=0
while [ $TRIES -lt 10 ]; do
  if curl -sf http://127.0.0.1:3129/healthz > /dev/null 2>&1; then
    echo "[restart-openshell] OpenShell healthy" | tee -a "$LOG_FILE"
    exit 0
  fi
  TRIES=$((TRIES + 1))
  sleep 0.5
done

echo "[restart-openshell] WARNING: health check did not pass within 5s" | tee -a "$LOG_FILE"
exit 0
