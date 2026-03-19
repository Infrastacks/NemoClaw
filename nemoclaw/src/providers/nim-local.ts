// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { InferenceProvider } from "./interface.js";
import { createProviderPlugin } from "./interface.js";
import { validateApiKey } from "../onboard/validate.js";
import { promptInput } from "../onboard/prompt.js";

export const nimLocalProvider: InferenceProvider = {
  id: "nim-local",
  label: "Self-hosted NIM [experimental]",
  endpointTypes: ["nim-local"],
  profileName: "nim-local",
  providerName: "nim-local",
  credentialEnvVar: "NIM_API_KEY",
  requiresApiKey: true,
  defaultCredential: "",
  defaultEndpoint: "http://nim-service.local:8000/v1",
  isLocal: true,
  isExperimental: true,
  curatedModels: [],
  requiredEnvVars: ["NIM_API_KEY"],
  optionalEnvVars: [],

  wizardHint() {
    return "experimental — your own NIM container deployment";
  },

  async resolveEndpointUrl(ctx) {
    return ctx.endpointUrl ?? (await promptInput("NIM endpoint URL", "http://nim-service.local:8000/v1"));
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
    return "Local NIM";
  },
};
