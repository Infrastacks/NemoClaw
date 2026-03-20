// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

export type {
  InferenceProvider,
  InferenceProfileConfig,
  ProviderType,
  ModelOption,
  WizardContext,
  EndpointResolutionContext,
} from "./interface.js";
export { createProviderPlugin } from "./interface.js";
export { ProviderRegistry } from "./registry.js";
export { nvidiaBuildProvider, CURATED_MODELS } from "./nvidia-build.js";
export { nvidiaNcpProvider } from "./nvidia-ncp.js";
export { nimLocalProvider } from "./nim-local.js";
export { vllmProvider } from "./vllm.js";
export { ollamaProvider, detectOllama, parseOllamaList } from "./ollama.js";
export { azureOpenAIProvider } from "./azure-openai.js";

import { ProviderRegistry } from "./registry.js";
import { nvidiaBuildProvider } from "./nvidia-build.js";
import { nvidiaNcpProvider } from "./nvidia-ncp.js";
import { nimLocalProvider } from "./nim-local.js";
import { vllmProvider } from "./vllm.js";
import { ollamaProvider } from "./ollama.js";
import { azureOpenAIProvider } from "./azure-openai.js";

export function createDefaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(nvidiaBuildProvider);
  registry.register(nvidiaNcpProvider);
  registry.register(azureOpenAIProvider);
  registry.register(nimLocalProvider);
  registry.register(vllmProvider);
  registry.register(ollamaProvider);
  return registry;
}
