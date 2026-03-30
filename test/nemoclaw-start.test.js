// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "..", "scripts", "nemoclaw-start.sh");

function writeOpenclawStub(binDir) {
  const stubPath = path.join(binDir, "openclaw");
  fs.writeFileSync(
    stubPath,
    `#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="\${TEST_STATE_DIR:?}"
mkdir -p "$STATE_DIR"
cmd="\${1:-}"
sub="\${2:-}"
case "$cmd:$sub" in
  doctor:*)
    exit 0
    ;;
  plugins:install)
    exit 0
    ;;
  gateway:run)
    exit 0
    ;;
  devices:list)
    count_file="$STATE_DIR/list-count"
    count=0
    if [ -f "$count_file" ]; then
      count="$(cat "$count_file")"
    fi
    count=$((count + 1))
    printf '%s' "$count" > "$count_file"
    if [ "\${ENABLE_PENDING_DEVICES:-0}" = "1" ] && [ "$count" -eq 1 ]; then
      cat <<'JSON'
{"pending":[{"requestId":"browser-1","clientId":"openclaw-control-ui","clientMode":"webchat"},{"requestId":"cli-1","clientId":"terminal","clientMode":"cli"}],"paired":[]}
JSON
    else
      cat <<'JSON'
{"pending":[],"paired":[{"clientId":"openclaw-control-ui","clientMode":"webchat"}]}
JSON
    fi
    ;;
  devices:approve)
    printf '%s\\n' "\${3:-}" >> "$STATE_DIR/approved"
    printf '{"ok":true}\\n'
    ;;
  *)
    exit 0
    ;;
esac
`,
    { mode: 0o755 },
  );
}

function runNemoclawStart(options = {}) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-start-test-"));
  const binDir = path.join(homeDir, "bin");
  const stateDir = path.join(homeDir, "state");
  fs.mkdirSync(binDir, { recursive: true });
  writeOpenclawStub(binDir);

  if (typeof options.setup === "function") {
    options.setup(homeDir);
  }

  const result = spawnSync("bash", [SCRIPT, ...(options.args ?? [])], {
    encoding: "utf-8",
    env: {
      ...process.env,
      HOME: homeDir,
      PATH: `${binDir}:${process.env.PATH}`,
      TEST_STATE_DIR: stateDir,
      ...options.env,
    },
  });

  return { result, homeDir, stateDir };
}

function readOpenclawConfig(homeDir) {
  const configPath = path.join(homeDir, ".openclaw", "openclaw.json");
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(filePath, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf-8");
    }
    await sleep(100);
  }
  return null;
}

describe("nemoclaw-start security defaults", () => {
  it("leaves insecure control UI auth disabled by default", () => {
    const { result, homeDir } = runNemoclawStart({ args: ["true"] });
    assert.equal(result.status, 0, result.stderr);

    const config = readOpenclawConfig(homeDir);
    assert.equal(config.gateway.controlUi.allowInsecureAuth, undefined);
    assert.equal(config.gateway.controlUi.dangerouslyDisableDeviceAuth, undefined);
    assert.deepEqual(config.gateway.trustedProxies, ["127.0.0.1", "::1"]);
  });

  it("re-enables insecure control UI auth only with the explicit flag", () => {
    const { result, homeDir } = runNemoclawStart({
      args: ["true"],
      env: { NEMOCLAW_ALLOW_INSECURE_CONTROL_UI: "1" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /insecure dashboard auth enabled/i);

    const config = readOpenclawConfig(homeDir);
    assert.equal(config.gateway.controlUi.allowInsecureAuth, true);
    assert.equal(config.gateway.controlUi.dangerouslyDisableDeviceAuth, true);
  });

  it("does not print tokenized dashboard URLs and skips auto-pair by default", () => {
    const token = "secret-dashboard-token";
    const { result, stateDir } = runNemoclawStart({
      setup(homeDir) {
        const configDir = path.join(homeDir, ".openclaw");
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, "openclaw.json"),
          JSON.stringify({ gateway: { auth: { token } } }),
        );
      },
      env: { ENABLE_PENDING_DEVICES: "1" },
    });

    assert.equal(result.status, 0, result.stderr);
    const output = `${result.stdout}${result.stderr}`;
    assert.ok(!output.includes(token));
    assert.ok(!output.includes("#token="));
    assert.match(output, /Complete normal browser pairing\/auth/i);
    assert.equal(fs.existsSync(path.join(stateDir, "approved")), false);
    assert.equal(fs.existsSync(path.join(stateDir, "list-count")), false);
  });

  it("auto-approves only browser pairing requests when explicitly enabled", async () => {
    const { result, stateDir } = runNemoclawStart({
      env: {
        ENABLE_PENDING_DEVICES: "1",
        NEMOCLAW_AUTO_APPROVE_DEVICES: "1",
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /automatic browser pairing enabled/i);

    const approvals = await waitForFile(path.join(stateDir, "approved"));
    assert.ok(approvals, "expected browser approval log");
    assert.deepEqual(
      approvals.trim().split("\n"),
      ["browser-1"],
    );
  });
});
