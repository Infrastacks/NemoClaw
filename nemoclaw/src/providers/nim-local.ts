// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { InferenceProvider, InferenceProfileConfig } from "./interface.js";
import { createOpenShellProviderConfig, createProviderPlugin } from "./interface.js";
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
  providerType: "local",
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

  async validateCredentials(apiKey, endpointUrl) {
    const result = await validateApiKey(apiKey, endpointUrl);
    return result.valid;
  },

  toProviderPlugin(model, credentialEnv) {
    return createProviderPlugin(model, credentialEnv, []);
  },

  toBlueprintProfile(model, credentialEnv): InferenceProfileConfig {
    return {
      provider_type: "openai",
      provider_name: this.providerName,
      endpoint: this.defaultEndpoint,
      model,
      credential_env: credentialEnv,
    };
  },

  toOpenShellProviderConfig(apiKey, endpointUrl) {
    return createOpenShellProviderConfig("openai", this.credentialEnvVar, this.credentialEnvVar, endpointUrl, {
      useEnvRef: true,
    });
  },

  describeProvider() {
    return "Local NIM";
  },
};
