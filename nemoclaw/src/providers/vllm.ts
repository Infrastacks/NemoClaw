// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { InferenceProvider } from "./interface.js";
import { createProviderPlugin } from "./interface.js";
import { validateApiKey } from "../onboard/validate.js";

const HOST_GATEWAY = "http://host.openshell.internal";

export const vllmProvider: InferenceProvider = {
  id: "vllm",
  label: "Local vLLM [experimental]",
  endpointTypes: ["vllm"],
  profileName: "vllm",
  providerName: "vllm-local",
  credentialEnvVar: "OPENAI_API_KEY",
  requiresApiKey: false,
  defaultCredential: "dummy",
  defaultEndpoint: `${HOST_GATEWAY}:8000/v1`,
  isLocal: true,
  isExperimental: true,
  curatedModels: [],
  requiredEnvVars: [],
  optionalEnvVars: ["OPENAI_API_KEY"],

  wizardHint() {
    return "experimental — local development";
  },

  async resolveEndpointUrl() {
    return `${HOST_GATEWAY}:8000/v1`;
  },

  async resolveExtraConfig() {
    return {};
  },

  async discoverModels(apiKey, endpointUrl) {
    const result = await validateApiKey(apiKey, endpointUrl);
    return result.models;
  },

  buildModelOptions(discoveredModels) {
    return discoveredModels.map((id) => ({ id, label: id }));
  },

  defaultModelId(discoveredModels) {
    return discoveredModels[0] ?? "";
  },

  toProviderPlugin(model, credentialEnv) {
    return createProviderPlugin(model, credentialEnv, []);
  },

  describeProvider() {
    return "Local vLLM";
  },
};
