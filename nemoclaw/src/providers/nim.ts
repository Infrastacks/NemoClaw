// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { ModelProviderEntry } from "../index.js";
import type { InferenceProvider, InferenceProfileConfig, ModelOption } from "./interface.js";
import { createOpenShellProviderConfig, createProviderPlugin } from "./interface.js";
import { validateApiKey } from "../onboard/validate.js";
import { promptInput } from "../onboard/prompt.js";

// ---------------------------------------------------------------------------
// NIM model catalog types
// ---------------------------------------------------------------------------

export interface NimModel {
  id: string;
  name: string;
  license: "community" | "enterprise" | "research";
  versions: string[];
}

interface CatalogEntry {
  data: NimModel[];
  fetchedAt: number;
}

// ---------------------------------------------------------------------------
// Catalog cache — 5-minute TTL
// ---------------------------------------------------------------------------

const CATALOG_TTL_MS = 5 * 60 * 1000;
const catalogCache = new Map<string, CatalogEntry>();

function getCachedCatalog(cacheKey: string): NimModel[] | null {
  const entry = catalogCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CATALOG_TTL_MS) {
    catalogCache.delete(cacheKey);
    return null;
  }
  return entry.data;
}

function setCachedCatalog(cacheKey: string, models: NimModel[]): void {
  catalogCache.set(cacheKey, { data: models, fetchedAt: Date.now() });
}

// Exposed for testing
export function clearCatalogCache(): void {
  catalogCache.clear();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLOUD_ENDPOINT = "https://integrate.api.nvidia.com/v1";

function isCloudEndpoint(url: string): boolean {
  return url.includes("api.nvidia.com");
}

// ---------------------------------------------------------------------------
// Curated NIM models (well-known models available on the NIM catalog)
// ---------------------------------------------------------------------------

export const NIM_CURATED_MODELS: ModelOption[] = [
  { id: "nvidia/nemotron-3-super-120b-a12b", label: "Nemotron 3 Super 120B" },
  { id: "nvidia/llama-3.1-nemotron-ultra-253b-v1", label: "Nemotron Ultra 253B" },
  { id: "nvidia/llama-3.3-nemotron-super-49b-v1.5", label: "Nemotron Super 49B v1.5" },
  { id: "nvidia/nemotron-3-nano-30b-a3b", label: "Nemotron 3 Nano 30B" },
];

const DEFAULT_PLUGIN_MODELS: ModelProviderEntry[] = [
  {
    id: "nvidia/nemotron-3-super-120b-a12b",
    label: "Nemotron 3 Super 120B (NIM)",
    contextWindow: 131072,
    maxOutput: 8192,
  },
  {
    id: "nvidia/llama-3.1-nemotron-ultra-253b-v1",
    label: "Nemotron Ultra 253B (NIM)",
    contextWindow: 131072,
    maxOutput: 4096,
  },
];

// ---------------------------------------------------------------------------
// NIM catalog fetcher
// ---------------------------------------------------------------------------

export async function fetchNimCatalog(
  endpointUrl: string,
  apiKey: string,
): Promise<NimModel[]> {
  const cacheKey = `${endpointUrl}:${apiKey.slice(-8)}`;
  const cached = getCachedCatalog(cacheKey);
  if (cached) return cached;

  const modelsUrl = `${endpointUrl.replace(/\/+$/, "")}/models`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(modelsUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });

    if (!response.ok) return [];

    const json = (await response.json()) as {
      data?: Array<{
        id: string;
        name?: string;
        license?: string;
        versions?: string[];
      }>;
    };

    const models: NimModel[] = (json.data ?? []).map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      license: (m.license as NimModel["license"]) ?? "community",
      versions: m.versions ?? [],
    }));

    setCachedCatalog(cacheKey, models);
    return models;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// NIM Provider
// ---------------------------------------------------------------------------

export const nimProvider: InferenceProvider = {
  id: "nim",
  label: "NVIDIA NIM",
  endpointTypes: ["nim", "nim-cloud"],
  profileName: "nim",
  providerName: "nvidia-nim",
  credentialEnvVar: "NGC_API_KEY",
  requiresApiKey: true,
  defaultCredential: "",
  defaultEndpoint: CLOUD_ENDPOINT,
  providerType: "nvidia",
  isLocal: false,
  isExperimental: false,
  curatedModels: NIM_CURATED_MODELS,
  requiredEnvVars: ["NGC_API_KEY"],
  optionalEnvVars: ["NIM_VERSION"],

  wizardHint() {
    return "NVIDIA NIM — cloud or self-hosted inference";
  },

  async resolveEndpointUrl(ctx) {
    if (ctx.endpointUrl) {
      return ctx.endpointUrl.replace(/\/+$/, "");
    }
    if (ctx.endpointType === "nim-cloud") {
      return CLOUD_ENDPOINT;
    }
    const input = await promptInput(
      "NIM endpoint URL (e.g., https://integrate.api.nvidia.com/v1 or http://nim-host:8000/v1)",
      CLOUD_ENDPOINT,
    );
    return input.replace(/\/+$/, "");
  },

  async resolveExtraConfig(): Promise<Record<string, string | null>> {
    return {};
  },

  async discoverModels(apiKey, endpointUrl) {
    // Use the catalog fetcher for cloud, or fall back to the standard models endpoint
    if (isCloudEndpoint(endpointUrl)) {
      const catalog = await fetchNimCatalog(endpointUrl, apiKey);
      if (catalog.length > 0) return catalog.map((m) => m.id);
    }
    // Self-hosted NIM or empty catalog: standard OpenAI-compatible /models
    const result = await validateApiKey(apiKey, endpointUrl);
    return result.models;
  },

  buildModelOptions(discoveredModels) {
    const curated = NIM_CURATED_MODELS.filter((m) => discoveredModels.includes(m.id)).map((m) => ({
      id: m.id,
      label: `${m.label} (${m.id})`,
    }));
    if (curated.length > 0) return curated;

    // No curated match — return discovered models directly
    if (discoveredModels.length > 0) {
      return discoveredModels.map((id) => ({ id, label: id }));
    }

    return NIM_CURATED_MODELS.map((m) => ({ id: m.id, label: `${m.label} (${m.id})` }));
  },

  defaultModelId(discoveredModels) {
    const first = NIM_CURATED_MODELS.find((m) => discoveredModels.includes(m.id));
    return first?.id ?? discoveredModels[0] ?? NIM_CURATED_MODELS[0].id;
  },

  async validateCredentials(apiKey, endpointUrl) {
    const result = await validateApiKey(apiKey, endpointUrl);
    return result.valid;
  },

  toProviderPlugin(model, credentialEnv) {
    return createProviderPlugin(model, credentialEnv, DEFAULT_PLUGIN_MODELS);
  },

  toBlueprintProfile(model, credentialEnv): InferenceProfileConfig {
    return {
      provider_type: "nvidia",
      provider_name: this.providerName,
      endpoint: this.defaultEndpoint,
      model,
      credential_env: credentialEnv,
    };
  },

  toOpenShellProviderConfig(apiKey, endpointUrl) {
    return createOpenShellProviderConfig("openai", this.credentialEnvVar, apiKey, endpointUrl);
  },

  describeProvider() {
    return "NVIDIA NIM";
  },
};
