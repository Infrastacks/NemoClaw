#!/usr/bin/env node
// Writes OpenClaw gateway configuration from environment variables.
// Called by entrypoint.sh before starting the gateway.

const fs = require("fs");
const os = require("os");
const path = require("path");

const home = os.homedir();
const openclawDir = path.join(home, ".openclaw");
const agentDir = path.join(openclawDir, "agents", "main", "agent");

fs.mkdirSync(agentDir, { recursive: true });

// --- openclaw.json ---

const inferenceEndpoint =
  process.env.INFERENCE_ENDPOINT || "https://integrate.api.nvidia.com/v1";
const apiKey = process.env.NVIDIA_API_KEY || "";
const model =
  process.env.NEMOCLAW_MODEL || "nvidia/llama-3.1-nemotron-70b-instruct";

// NVIDIA NCP API expects full "nvidia/model-name" in requests.
// Use "ncp" as OpenClaw provider name so it strips "ncp/" prefix,
// preserving the "nvidia/" prefix that the API needs.
const modelId = model;

const config = {
  agents: {
    defaults: { model: { primary: `ncp/${modelId}` } },
  },
  models: {
    mode: "merge",
    providers: {
      ncp: {
        baseUrl: inferenceEndpoint,
        apiKey: apiKey,
        api: "openai-completions",
        models: [
          {
            id: modelId,
            name: `NVIDIA ${modelId}`,
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 131072,
            maxTokens: 4096,
          },
        ],
      },
    },
  },
  gateway: {
    mode: "local",
    controlUi: {
      allowInsecureAuth: true,
      dangerouslyDisableDeviceAuth: true,
      dangerouslyAllowHostHeaderOriginFallback: true,
      // Accept proxy origins — access is gated by Codicera session tokens
      allowedOrigins: [
        "https://api.codicera.com",
        "https://codicera-api-production.infrastacks.workers.dev",
        "http://localhost:18789",
        "http://127.0.0.1:18789",
      ],
    },
    trustedProxies: ["127.0.0.1", "::1", "10.0.0.0/8"],
  },
};

const configPath = path.join(openclawDir, "openclaw.json");
fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
console.log("[configure] wrote", configPath);

// --- auth-profiles.json ---

if (apiKey) {
  const authProfiles = {
    "nvidia:manual": {
      type: "api_key",
      provider: "nvidia",
      keyRef: { source: "env", id: "NVIDIA_API_KEY" },
      profileId: "nvidia:manual",
    },
  };
  const authPath = path.join(agentDir, "auth-profiles.json");
  fs.writeFileSync(authPath, JSON.stringify(authProfiles, null, 2), {
    mode: 0o600,
  });
  console.log("[configure] wrote", authPath);
}
