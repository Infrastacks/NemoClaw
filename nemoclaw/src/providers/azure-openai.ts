// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { InferenceProvider, InferenceProfileConfig, ProviderPlugin } from "./interface.js";
import { validateApiKey, azureValidateOptions } from "../onboard/validate.js";
import { promptInput } from "../onboard/prompt.js";

export const azureOpenAIProvider: InferenceProvider = {
  id: "azure",
  label: "Azure OpenAI",
  endpointTypes: ["azure"],
  profileName: "azure",
  providerName: "azure-openai",
  credentialEnvVar: "AZURE_OPENAI_API_KEY",
  requiresApiKey: true,
  defaultCredential: "",
  defaultEndpoint: "",
  providerType: "azure_openai",
  isLocal: false,
  isExperimental: false,
  curatedModels: [],
  requiredEnvVars: ["AZURE_OPENAI_API_KEY"],
  optionalEnvVars: ["AZURE_OPENAI_API_VERSION"],

  wizardHint() {
    return "your Azure OpenAI resource";
  },

  async resolveEndpointUrl(ctx) {
    let input = ctx.endpointUrl;
    if (!input) {
      input = await promptInput(
        "Azure OpenAI resource name or URL (e.g., my-resource or https://my-resource.openai.azure.com)",
      );
    }
    if (!input) return "";

    // If it looks like a bare resource name (no protocol, no dots), build the full URL
    if (!input.includes("://") && !input.includes(".")) {
      return `https://${input}.openai.azure.com`;
    }

    // Otherwise treat as full URL — strip trailing slashes
    return input.replace(/\/+$/, "");
  },

  async resolveExtraConfig(): Promise<Record<string, string | null>> {
    return {};
  },

  async discoverModels(apiKey, endpointUrl) {
    const result = await validateApiKey(apiKey, endpointUrl, azureValidateOptions(apiKey, endpointUrl));
    return result.models;
  },

  buildModelOptions(discoveredModels) {
    return discoveredModels.map((id) => ({ id, label: id }));
  },

  defaultModelId(discoveredModels) {
    return discoveredModels[0] ?? "";
  },

  async validateCredentials(apiKey, endpointUrl) {
    const result = await validateApiKey(apiKey, endpointUrl, azureValidateOptions(apiKey, endpointUrl));
    return result.valid;
  },

  toProviderPlugin(model, credentialEnv): ProviderPlugin {
    const chatModels = model
      ? [{ id: `inference/${model}`, label: model, contextWindow: 131072, maxOutput: 8192 }]
      : [];

    return {
      id: "inference",
      label: "Managed Inference Route",
      aliases: ["inference-local", "nemoclaw"],
      envVars: [credentialEnv],
      models: { chat: chatModels },
      auth: [
        {
          type: "api-key",
          headerName: "api-key",
          envVar: credentialEnv,
          label: `Azure OpenAI API Key (${credentialEnv})`,
        },
      ],
    };
  },

  toBlueprintProfile(model, credentialEnv): InferenceProfileConfig {
    return {
      provider_type: "openai",
      provider_name: this.providerName,
      endpoint: "",
      model,
      credential_env: credentialEnv,
      dynamic_endpoint: true,
    };
  },

  describeProvider() {
    return "Azure OpenAI";
  },
};
