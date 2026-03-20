// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { InferenceProvider, InferenceProfileConfig } from "./interface.js";
import { createOpenShellProviderConfig, createProviderPlugin } from "./interface.js";
import { validateApiKey } from "../onboard/validate.js";
import { promptInput } from "../onboard/prompt.js";
import { CURATED_MODELS } from "./nvidia-build.js";

export const nvidiaNcpProvider: InferenceProvider = {
  id: "ncp",
  label: "NVIDIA Cloud Partner (NCP)",
  endpointTypes: ["ncp", "custom"],
  profileName: "ncp",
  providerName: "nvidia-ncp",
  credentialEnvVar: "NVIDIA_API_KEY",
  requiresApiKey: true,
  defaultCredential: "",
  defaultEndpoint: "",
  providerType: "nvidia",
  isLocal: false,
  isExperimental: false,
  curatedModels: CURATED_MODELS,
  requiredEnvVars: ["NVIDIA_API_KEY"],
  optionalEnvVars: [],

  wizardHint() {
    return "dedicated capacity, SLA-backed";
  },

  async resolveEndpointUrl(ctx) {
    if (ctx.endpointUrl) return ctx.endpointUrl;
    if (ctx.endpointType === "custom") {
      return promptInput("Custom endpoint URL");
    }
    return promptInput("NCP endpoint URL (e.g., https://partner.api.nvidia.com/v1)");
  },

  async resolveExtraConfig(ctx): Promise<Record<string, string | null>> {
    if (ctx.endpointType !== "ncp") return {};
    const ncpPartner = ctx.ncpPartner ?? (await promptInput("NCP partner name"));
    return { ncpPartner };
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

  async validateCredentials(apiKey, endpointUrl) {
    const result = await validateApiKey(apiKey, endpointUrl);
    return result.valid;
  },

  toProviderPlugin(model, credentialEnv) {
    return createProviderPlugin(model, credentialEnv, []);
  },

  toBlueprintProfile(model, credentialEnv): InferenceProfileConfig {
    return {
      provider_type: "nvidia",
      provider_name: this.providerName,
      endpoint: "",
      model,
      credential_env: credentialEnv,
      dynamic_endpoint: true,
    };
  },

  toOpenShellProviderConfig(apiKey, endpointUrl) {
    return createOpenShellProviderConfig("openai", this.credentialEnvVar, apiKey, endpointUrl);
  },

  describeProvider() {
    return "NVIDIA Cloud Partner";
  },
};
