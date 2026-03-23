#!/usr/bin/env node
// Writes OpenClaw gateway configuration from environment variables.
// Called by entrypoint.sh before starting the gateway.
// Supports multiple inference providers: ncp (NVIDIA), azure (Azure AI Foundry).

const fs = require("fs");
const os = require("os");
const path = require("path");

const home = os.homedir();
const openclawDir = path.join(home, ".openclaw");
const agentDir = path.join(openclawDir, "agents", "main", "agent");

fs.mkdirSync(agentDir, { recursive: true });

// --- Provider detection ---

const providerType = process.env.INFERENCE_PROVIDER_TYPE || "ncp";
const model =
  process.env.NEMOCLAW_MODEL || "nvidia/llama-3.1-nemotron-70b-instruct";
const modelId = model;

// Build provider-specific config
let providerName, baseUrl, apiKey, apiKeyEnvVar, authProfileId, authProfileProvider;

if (providerType === "azure") {
  providerName = "azure";
  baseUrl = "http://127.0.0.1:9001/v1";
  apiKey = process.env.AZURE_OPENAI_API_KEY || "";
  apiKeyEnvVar = "AZURE_OPENAI_API_KEY";
  authProfileId = "azure:manual";
  authProfileProvider = "azure";
} else {
  // Default: NVIDIA NCP
  providerName = "ncp";
  baseUrl = "http://127.0.0.1:9000/v1";
  apiKey = process.env.NVIDIA_API_KEY || "";
  apiKeyEnvVar = "NVIDIA_API_KEY";
  authProfileId = "nvidia:manual";
  authProfileProvider = "nvidia";
}

console.log(`[configure] provider=${providerName} model=${modelId}`);

// --- openclaw.json ---

// Use provider name as prefix so OpenClaw strips it, preserving the model ID.
// E.g., "ncp/nvidia/llama-..." → strips "ncp/" → sends "nvidia/llama-..."
// E.g., "azure/gpt-5.4-mini" → strips "azure/" → sends "gpt-5.4-mini"
const config = {
  agents: {
    defaults: { model: { primary: `${providerName}/${modelId}` } },
  },
  models: {
    mode: "merge",
    providers: {
      [providerName]: {
        baseUrl: baseUrl,
        apiKey: apiKey,
        api: "openai-completions",
        models: [
          {
            id: modelId,
            name: `${providerName.toUpperCase()} ${modelId}`,
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
    [authProfileId]: {
      type: "api_key",
      provider: authProfileProvider,
      keyRef: { source: "env", id: apiKeyEnvVar },
      profileId: authProfileId,
    },
  };
  const authPath = path.join(agentDir, "auth-profiles.json");
  fs.writeFileSync(authPath, JSON.stringify(authProfiles, null, 2), {
    mode: 0o600,
  });
  console.log("[configure] wrote", authPath);
}
