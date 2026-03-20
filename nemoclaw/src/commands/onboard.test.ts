// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginLogger, NemoClawConfig } from "../index.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => ""),
}));

vi.mock("../onboard/config.js", () => ({
  describeOnboardEndpoint: vi.fn(() => "endpoint"),
  describeOnboardProvider: vi.fn(() => "provider"),
  loadOnboardConfig: vi.fn(() => null),
  saveOnboardConfig: vi.fn(),
}));

vi.mock("../onboard/prompt.js", () => ({
  promptInput: vi.fn(),
  promptConfirm: vi.fn(),
  promptSelect: vi.fn(),
}));

const fakeProviders = new Map<string, unknown>();

vi.mock("../providers/index.js", () => ({
  createDefaultRegistry: vi.fn(() => ({
    get: (id: string) => fakeProviders.get(id),
    list: () => Array.from(fakeProviders.values()),
    resolve: (id: string) => {
      const provider = fakeProviders.get(id);
      if (!provider) {
        throw new Error(`Unknown endpoint type: ${id}`);
      }
      return provider;
    },
  })),
  detectOllama: vi.fn(() => ({ installed: false, running: false })),
}));

const { execFileSync } = await import("node:child_process");
const { saveOnboardConfig } = await import("../onboard/config.js");
const { cliOnboard } = await import("./onboard.js");

const defaultConfig: NemoClawConfig = {
  blueprintVersion: "latest",
  blueprintRegistry: "ghcr.io/nvidia/nemoclaw-blueprint",
  sandboxName: "openclaw",
  inferenceProvider: "nvidia",
};

const logger: PluginLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
  fakeProviders.clear();
});

describe("cliOnboard", () => {
  it("uses provider-owned validation and provisioning config for Azure", async () => {
    const validateCredentials = vi.fn().mockResolvedValue(true);
    const discoverModels = vi.fn().mockResolvedValue(["gpt-4o"]);
    fakeProviders.set("azure", {
      id: "azure",
      label: "Azure OpenAI",
      endpointTypes: ["azure"],
      profileName: "azure",
      providerName: "azure-openai",
      credentialEnvVar: "AZURE_OPENAI_API_KEY",
      requiresApiKey: true,
      defaultCredential: "",
      defaultEndpoint: "",
      isLocal: false,
      providerType: "azure_openai",
      isExperimental: false,
      curatedModels: [],
      requiredEnvVars: ["AZURE_OPENAI_API_KEY"],
      optionalEnvVars: ["AZURE_OPENAI_API_VERSION"],
      wizardHint: () => "",
      resolveEndpointUrl: async () => "https://my-resource.openai.azure.com",
      resolveExtraConfig: async () => ({}),
      discoverModels,
      buildModelOptions: (models: string[]) => models.map((id) => ({ id, label: id })),
      defaultModelId: (models: string[]) => models[0] ?? "",
      validateCredentials,
      toProviderPlugin: vi.fn(),
      toBlueprintProfile: vi.fn(),
      toOpenShellProviderConfig: vi.fn(() => ({
        type: "openai",
        credentials: { AZURE_OPENAI_API_KEY: "azure-key" },
        config: { OPENAI_BASE_URL: "https://my-resource.openai.azure.com" },
      })),
      describeProvider: () => "Azure OpenAI",
    });

    await cliOnboard({
      endpoint: "azure",
      endpointUrl: "https://my-resource.openai.azure.com",
      apiKey: "azure-key",
      model: "gpt-4o",
      logger,
      pluginConfig: defaultConfig,
    });

    expect(validateCredentials).toHaveBeenCalledWith(
      "azure-key",
      "https://my-resource.openai.azure.com",
    );
    expect(execFileSync).toHaveBeenCalledWith(
      "openshell",
      expect.arrayContaining([
        "provider",
        "create",
        "--name",
        "azure-openai",
        "--type",
        "openai",
        "--credential",
        "AZURE_OPENAI_API_KEY=azure-key",
        "--config",
        "OPENAI_BASE_URL=https://my-resource.openai.azure.com",
      ]),
      expect.any(Object),
    );
    expect(saveOnboardConfig).toHaveBeenCalledOnce();
  });

  it("uses provider-owned provisioning config for non-Azure providers on update", async () => {
    const validateCredentials = vi.fn().mockResolvedValue(true);
    fakeProviders.set("build", {
      id: "build",
      label: "NVIDIA Build",
      endpointTypes: ["build"],
      profileName: "default",
      providerName: "nvidia-nim",
      credentialEnvVar: "NVIDIA_API_KEY",
      requiresApiKey: true,
      defaultCredential: "",
      defaultEndpoint: "https://integrate.api.nvidia.com/v1",
      isLocal: false,
      providerType: "nvidia",
      isExperimental: false,
      curatedModels: [],
      requiredEnvVars: ["NVIDIA_API_KEY"],
      optionalEnvVars: [],
      wizardHint: () => "",
      resolveEndpointUrl: async () => "https://integrate.api.nvidia.com/v1",
      resolveExtraConfig: async () => ({}),
      discoverModels: vi.fn().mockResolvedValue(["nvidia/model"]),
      buildModelOptions: (models: string[]) => models.map((id) => ({ id, label: id })),
      defaultModelId: (models: string[]) => models[0] ?? "",
      validateCredentials,
      toProviderPlugin: vi.fn(),
      toBlueprintProfile: vi.fn(),
      toOpenShellProviderConfig: vi.fn(() => ({
        type: "openai",
        credentials: { NVIDIA_API_KEY: "nvapi-test" },
        config: { OPENAI_BASE_URL: "https://integrate.api.nvidia.com/v1" },
      })),
      describeProvider: () => "NVIDIA Cloud API",
    });

    vi.mocked(execFileSync)
      .mockImplementationOnce(() => {
        const error = new Error("AlreadyExists");
        Object.assign(error, { stderr: "AlreadyExists" });
        throw error;
      })
      .mockImplementation(() => "");

    await cliOnboard({
      endpoint: "build",
      apiKey: "nvapi-test",
      model: "nvidia/model",
      logger,
      pluginConfig: defaultConfig,
    });

    expect(validateCredentials).toHaveBeenCalledWith(
      "nvapi-test",
      "https://integrate.api.nvidia.com/v1",
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      "openshell",
      expect.arrayContaining([
        "provider",
        "update",
        "nvidia-nim",
        "--credential",
        "NVIDIA_API_KEY=nvapi-test",
        "--config",
        "OPENAI_BASE_URL=https://integrate.api.nvidia.com/v1",
      ]),
      expect.any(Object),
    );
  });
});
