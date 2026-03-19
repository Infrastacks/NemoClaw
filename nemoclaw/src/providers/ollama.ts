// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { execSync } from "node:child_process";
import type { InferenceProvider } from "./interface.js";
import { createProviderPlugin } from "./interface.js";

const HOST_GATEWAY = "http://host.openshell.internal";
const DEFAULT_OLLAMA_MODEL = "nemotron-3-nano:30b";

function testCommand(command: string): boolean {
  try {
    execSync(command, { encoding: "utf-8", stdio: "ignore", shell: "/bin/bash" });
    return true;
  } catch {
    return false;
  }
}

export function detectOllama(): { installed: boolean; running: boolean } {
  const installed = testCommand("command -v ollama >/dev/null 2>&1");
  const running = testCommand("curl -sf http://localhost:11434/api/tags >/dev/null 2>&1");
  return { installed, running };
}

export function parseOllamaList(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^NAME\s+/i.test(line))
    .map((line) => line.split(/\s{2,}/)[0])
    .filter(Boolean);
}

function getOllamaModelOptions(): string[] {
  try {
    const output = execSync("ollama list", { encoding: "utf-8", shell: "/bin/bash" });
    const parsed = parseOllamaList(output);
    if (parsed.length > 0) return parsed;
  } catch {}
  return [DEFAULT_OLLAMA_MODEL];
}

function getDefaultOllamaModel(): string {
  const models = getOllamaModelOptions();
  return models.includes(DEFAULT_OLLAMA_MODEL) ? DEFAULT_OLLAMA_MODEL : models[0];
}

export const ollamaProvider: InferenceProvider = {
  id: "ollama",
  label: "Local Ollama",
  endpointTypes: ["ollama"],
  profileName: "ollama",
  providerName: "ollama-local",
  credentialEnvVar: "OPENAI_API_KEY",
  requiresApiKey: false,
  defaultCredential: "ollama",
  defaultEndpoint: `${HOST_GATEWAY}:11434/v1`,
  isLocal: true,
  isExperimental: false,
  curatedModels: [],
  requiredEnvVars: [],
  optionalEnvVars: ["OPENAI_API_KEY"],

  wizardHint(ctx) {
    if (ctx.ollamaRunning) return "detected on localhost:11434";
    if (ctx.ollamaInstalled) return "installed locally";
    return "localhost:11434";
  },

  async resolveEndpointUrl(ctx) {
    return ctx.endpointUrl ?? `${HOST_GATEWAY}:11434/v1`;
  },

  async resolveExtraConfig() {
    return {};
  },

  async discoverModels() {
    return getOllamaModelOptions();
  },

  buildModelOptions(discoveredModels) {
    return discoveredModels.map((id) => ({ id, label: id }));
  },

  defaultModelId(discoveredModels) {
    const def = getDefaultOllamaModel();
    return discoveredModels.includes(def) ? def : discoveredModels[0] ?? DEFAULT_OLLAMA_MODEL;
  },

  toProviderPlugin(model, credentialEnv) {
    return createProviderPlugin(model, credentialEnv, []);
  },

  describeProvider() {
    return "Local Ollama";
  },
};
