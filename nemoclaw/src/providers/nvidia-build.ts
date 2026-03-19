// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { ModelProviderEntry } from "../index.js";
import type { InferenceProvider, ModelOption } from "./interface.js";
import { createProviderPlugin } from "./interface.js";
import { validateApiKey } from "../onboard/validate.js";

export const CURATED_MODELS: ModelOption[] = [
  { id: "nvidia/nemotron-3-super-120b-a12b", label: "Nemotron 3 Super 120B" },
  { id: "moonshotai/kimi-k2.5", label: "Kimi K2.5" },
  { id: "z-ai/glm5", label: "GLM-5" },
  { id: "minimaxai/minimax-m2.5", label: "MiniMax M2.5" },
  { id: "qwen/qwen3.5-397b-a17b", label: "Qwen3.5 397B A17B" },
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
];

const DEFAULT_PLUGIN_MODELS: ModelProviderEntry[] = [
  {
    id: "nvidia/nemotron-3-super-120b-a12b",
    label: "Nemotron 3 Super 120B (March 2026)",
    contextWindow: 131072,
    maxOutput: 8192,
  },
  {
    id: "nvidia/llama-3.1-nemotron-ultra-253b-v1",
    label: "Nemotron Ultra 253B",
    contextWindow: 131072,
    maxOutput: 4096,
  },
  {
    id: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    label: "Nemotron Super 49B v1.5",
    contextWindow: 131072,
    maxOutput: 4096,
  },
  {
    id: "nvidia/nemotron-3-nano-30b-a3b",
    label: "Nemotron 3 Nano 30B",
    contextWindow: 131072,
    maxOutput: 4096,
  },
];

export const nvidiaBuildProvider: InferenceProvider = {
  id: "build",
  label: "NVIDIA Build (build.nvidia.com)",
  endpointTypes: ["build"],
  profileName: "default",
  providerName: "nvidia-nim",
  credentialEnvVar: "NVIDIA_API_KEY",
  requiresApiKey: true,
  defaultCredential: "",
  defaultEndpoint: "https://integrate.api.nvidia.com/v1",
  isLocal: false,
  isExperimental: false,
  curatedModels: CURATED_MODELS,
  requiredEnvVars: ["NVIDIA_API_KEY"],
  optionalEnvVars: [],

  wizardHint() {
    return "recommended — zero infra, free credits";
  },

  async resolveEndpointUrl() {
    return "https://integrate.api.nvidia.com/v1";
  },

  async resolveExtraConfig() {
    return {};
  },

  async discoverModels(apiKey, endpointUrl) {
    const result = await validateApiKey(apiKey, endpointUrl);
    return result.models;
  },

  buildModelOptions(discoveredModels) {
    const curated = CURATED_MODELS.filter((m) => discoveredModels.includes(m.id)).map((m) => ({
      id: m.id,
      label: `${m.label} (${m.id})`,
    }));
    if (curated.length > 0) return curated;
    return CURATED_MODELS.map((m) => ({ id: m.id, label: `${m.label} (${m.id})` }));
  },

  defaultModelId(discoveredModels) {
    const first = CURATED_MODELS.find((m) => discoveredModels.includes(m.id));
    return first?.id ?? CURATED_MODELS[0].id;
  },

  toProviderPlugin(model, credentialEnv) {
    return createProviderPlugin(model, credentialEnv, DEFAULT_PLUGIN_MODELS);
  },

  describeProvider() {
    return "NVIDIA Cloud API";
  },
};
