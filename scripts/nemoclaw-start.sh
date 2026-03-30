#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# NemoClaw sandbox entrypoint. Configures OpenClaw and starts the dashboard
# gateway inside the sandbox so the forwarded host port has a live upstream.
#
# Optional env:
#   NVIDIA_API_KEY   API key for NVIDIA-hosted inference
#   CHAT_UI_URL      Browser origin that will access the forwarded dashboard
#   NEMOCLAW_ALLOW_INSECURE_CONTROL_UI=1  Re-enable insecure local dashboard auth for dev/test
#   NEMOCLAW_AUTO_APPROVE_DEVICES=1       Auto-approve browser pairing requests for dev/test

set -euo pipefail

NEMOCLAW_CMD=("$@")
CHAT_UI_URL="${CHAT_UI_URL:-http://127.0.0.1:18789}"
PUBLIC_PORT=18789
ALLOW_INSECURE_CONTROL_UI="${NEMOCLAW_ALLOW_INSECURE_CONTROL_UI:-0}"
AUTO_APPROVE_DEVICES="${NEMOCLAW_AUTO_APPROVE_DEVICES:-0}"

warn_if_insecure_mode() {
  if [ "$ALLOW_INSECURE_CONTROL_UI" = "1" ]; then
    echo "[security] WARNING: insecure dashboard auth enabled via NEMOCLAW_ALLOW_INSECURE_CONTROL_UI=1"
  fi
  if [ "$AUTO_APPROVE_DEVICES" = "1" ]; then
    echo "[security] WARNING: automatic browser pairing enabled via NEMOCLAW_AUTO_APPROVE_DEVICES=1"
  fi
}

fix_openclaw_config() {
  python3 - <<'PYCFG'
import json
import os
from urllib.parse import urlparse

home = os.environ.get('HOME', '/sandbox')
config_path = os.path.join(home, '.openclaw', 'openclaw.json')
os.makedirs(os.path.dirname(config_path), exist_ok=True)

cfg = {}
if os.path.exists(config_path):
    with open(config_path) as f:
        cfg = json.load(f)

default_model = os.environ.get('NEMOCLAW_MODEL')
if default_model:
    cfg.setdefault('agents', {}).setdefault('defaults', {}).setdefault('model', {})['primary'] = default_model

chat_ui_url = os.environ.get('CHAT_UI_URL', 'http://127.0.0.1:18789')
parsed = urlparse(chat_ui_url)
chat_origin = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else 'http://127.0.0.1:18789'
local_origin = f'http://127.0.0.1:{os.environ.get("PUBLIC_PORT", "18789")}'
origins = [local_origin]
if chat_origin not in origins:
    origins.append(chat_origin)

gateway = cfg.setdefault('gateway', {})
gateway['mode'] = 'local'
control_ui = gateway.setdefault('controlUi', {})
control_ui['allowedOrigins'] = origins
allow_insecure = os.environ.get('NEMOCLAW_ALLOW_INSECURE_CONTROL_UI') == '1'
if allow_insecure:
    control_ui['allowInsecureAuth'] = True
    control_ui['dangerouslyDisableDeviceAuth'] = True
else:
    control_ui.pop('allowInsecureAuth', None)
    control_ui.pop('dangerouslyDisableDeviceAuth', None)
gateway['trustedProxies'] = ['127.0.0.1', '::1']

with open(config_path, 'w') as f:
    json.dump(cfg, f, indent=2)
os.chmod(config_path, 0o600)
PYCFG
}

write_auth_profile() {
  if [ -z "${NVIDIA_API_KEY:-}" ]; then
    return
  fi

  python3 - <<'PYAUTH'
import json
import os
path = os.path.expanduser('~/.openclaw/agents/main/agent/auth-profiles.json')
os.makedirs(os.path.dirname(path), exist_ok=True)
json.dump({
    'nvidia:manual': {
        'type': 'api_key',
        'provider': 'nvidia',
        'keyRef': {'source': 'env', 'id': 'NVIDIA_API_KEY'},
        'profileId': 'nvidia:manual',
    }
}, open(path, 'w'))
os.chmod(path, 0o600)
PYAUTH
}

print_dashboard_urls() {
  local chat_ui_base local_url remote_url
  chat_ui_base="${CHAT_UI_URL%/}"
  local_url="http://127.0.0.1:${PUBLIC_PORT}/"
  remote_url="${chat_ui_base}/"

  echo "[gateway] Local UI: ${local_url}"
  echo "[gateway] Remote UI: ${remote_url}"
  echo "[gateway] Complete normal browser pairing/auth in the control UI."
}

start_auto_pair() {
  nohup python3 - <<'PYAUTOPAIR' >> /tmp/gateway.log 2>&1 &
import json
import subprocess
import time

DEADLINE = time.time() + 600
QUIET_POLLS = 0
APPROVED = 0

def run(*args):
    proc = subprocess.run(args, capture_output=True, text=True)
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()

while time.time() < DEADLINE:
    rc, out, err = run('openclaw', 'devices', 'list', '--json')
    if rc != 0 or not out:
        time.sleep(1)
        continue
    try:
        data = json.loads(out)
    except Exception:
        time.sleep(1)
        continue

    pending = data.get('pending') or []
    paired = data.get('paired') or []
    has_browser = any((d.get('clientId') == 'openclaw-control-ui') or (d.get('clientMode') == 'webchat') for d in paired if isinstance(d, dict))

    if pending:
        QUIET_POLLS = 0
        for device in pending:
            current = device or {}
            request_id = current.get('requestId')
            if not request_id:
                continue
            is_browser = (
                current.get('clientId') == 'openclaw-control-ui' or
                current.get('clientMode') == 'webchat'
            )
            if not is_browser:
                client_id = current.get('clientId') or 'unknown'
                client_mode = current.get('clientMode') or 'unknown'
                print(f'[auto-pair] skipped non-browser request={request_id} clientId={client_id} clientMode={client_mode}')
                continue
            arc, aout, aerr = run('openclaw', 'devices', 'approve', request_id, '--json')
            if arc == 0:
                APPROVED += 1
                print(f'[auto-pair] approved browser request={request_id}')
            elif aout or aerr:
                print(f'[auto-pair] approve failed request={request_id}: {(aerr or aout)[:400]}')
        time.sleep(1)
        continue

    if has_browser:
        QUIET_POLLS += 1
        if QUIET_POLLS >= 4:
            print(f'[auto-pair] browser pairing converged approvals={APPROVED}')
            break
    elif APPROVED > 0:
        QUIET_POLLS += 1
    else:
        QUIET_POLLS = 0

    time.sleep(1)
else:
    print(f'[auto-pair] watcher timed out approvals={APPROVED}')
PYAUTOPAIR
  echo "[gateway] auto-pair watcher launched (pid $!)"
}

echo 'Setting up NemoClaw...'
openclaw doctor --fix > /dev/null 2>&1 || true
write_auth_profile
export CHAT_UI_URL PUBLIC_PORT
warn_if_insecure_mode
fix_openclaw_config
openclaw plugins install /opt/nemoclaw > /dev/null 2>&1 || true

if [ ${#NEMOCLAW_CMD[@]} -gt 0 ]; then
  exec "${NEMOCLAW_CMD[@]}"
fi

nohup openclaw gateway run > /tmp/gateway.log 2>&1 &
echo "[gateway] openclaw gateway launched (pid $!)"
if [ "$AUTO_APPROVE_DEVICES" = "1" ]; then
  start_auto_pair
fi
print_dashboard_urls
