// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { ProviderPlugin, ModelProviderEntry } from "../index.js";

export type { ProviderPlugin, ModelProviderEntry };

export interface ModelOption {
  id: string;
  label: string;
}

export interface WizardContext {
  ollamaInstalled: boolean;
  ollamaRunning: boolean;
}

export interface EndpointResolutionContext {
  endpointType: string;
  endpointUrl?: string;
  ncpPartner?: string;
  nonInteractive: boolean;
}

export type ProviderType = "nvidia" | "openai" | "azure_openai" | "bedrock" | "vertex" | "local";

export interface InferenceProfileConfig {
  provider_type: string;
  provider_name: string;
  endpoint: string;
  model: string;
  credential_env?: string;
  credential_default?: string;
  dynamic_endpoint?: boolean;
}

export interface OpenShellProviderConfig {
  type: string;
  credentials?: Record<string, string>;
  config?: Record<string, string>;
}

export interface InferenceProvider {
  readonly id: string;
  readonly label: string;
  readonly endpointTypes: readonly string[];
  readonly profileName: string;
  readonly providerName: string;
  readonly credentialEnvVar: string;
  readonly requiresApiKey: boolean;
  readonly defaultCredential: string;
  readonly defaultEndpoint: string;
  readonly isLocal: boolean;
  readonly providerType: ProviderType;
  readonly isExperimental: boolean;
  readonly curatedModels: ModelOption[];
  readonly requiredEnvVars: string[];
  readonly optionalEnvVars: string[];

  wizardHint(ctx: WizardContext): string;
  resolveEndpointUrl(ctx: EndpointResolutionContext): Promise<string>;
  resolveExtraConfig(ctx: EndpointResolutionContext): Promise<Record<string, string | null>>;
  discoverModels(apiKey: string, endpointUrl: string): Promise<string[]>;
  buildModelOptions(discoveredModels: string[]): ModelOption[];
  defaultModelId(discoveredModels: string[]): string;
  validateCredentials(apiKey: string, endpointUrl: string): Promise<boolean>;
  toProviderPlugin(model: string | null, credentialEnv: string): ProviderPlugin;
  toBlueprintProfile(model: string, credentialEnv: string): InferenceProfileConfig;
  toOpenShellProviderConfig(apiKey: string, endpointUrl: string): OpenShellProviderConfig;
  describeProvider(): string;
  estimateCost?(model: string, tokens: number): number;
}

/** Shared helper: builds the ProviderPlugin shape that OpenClaw expects. */
export function createProviderPlugin(
  model: string | null,
  credentialEnv: string,
  defaultModels: ModelProviderEntry[],
): ProviderPlugin {
  const authLabel =
    credentialEnv === "NVIDIA_API_KEY"
      ? `NVIDIA API Key (${credentialEnv})`
      : `OpenAI API Key (${credentialEnv})`;

  const chatModels: ModelProviderEntry[] = model
    ? [{ id: `inference/${model}`, label: model, contextWindow: 131072, maxOutput: 8192 }]
    : defaultModels;

  return {
    id: "inference",
    label: "Managed Inference Route",
    aliases: ["inference-local", "nemoclaw"],
    envVars: [credentialEnv],
    models: { chat: chatModels },
    auth: [{ type: "bearer", envVar: credentialEnv, headerName: "Authorization", label: authLabel }],
  };
}

export function createOpenShellProviderConfig(
  type: string,
  credentialKey: string,
  credentialValue: string,
  endpointUrl: string,
): OpenShellProviderConfig {
  return {
    type,
    credentials: { [credentialKey]: credentialValue },
    config: { OPENAI_BASE_URL: endpointUrl },
  };
}
