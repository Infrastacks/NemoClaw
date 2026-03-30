// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock validate.ts to prevent actual network calls
vi.mock("../onboard/validate.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../onboard/validate.js")>();
  return {
    ...actual,
    validateApiKey: vi.fn(),
  };
});

const { validateApiKey } = await import("../onboard/validate.js");
const { nimProvider, NIM_CURATED_MODELS, fetchNimCatalog, clearCatalogCache } = await import("./nim.js");

beforeEach(() => {
  vi.resetAllMocks();
  clearCatalogCache();
});

// ---------------------------------------------------------------------------
// Static properties
// ---------------------------------------------------------------------------

describe("nim provider static properties", () => {
  it("has correct identity fields", () => {
    expect(nimProvider.id).toBe("nim");
    expect(nimProvider.label).toBe("NVIDIA NIM");
    expect(nimProvider.profileName).toBe("nim");
    expect(nimProvider.providerName).toBe("nvidia-nim");
    expect(nimProvider.credentialEnvVar).toBe("NGC_API_KEY");
    expect(nimProvider.requiresApiKey).toBe(true);
    expect(nimProvider.defaultEndpoint).toBe("https://integrate.api.nvidia.com/v1");
    expect(nimProvider.isExperimental).toBe(false);
    expect(nimProvider.isLocal).toBe(false);
    expect(nimProvider.providerType).toBe("nvidia");
  });

  it("endpointTypes includes nim and nim-cloud", () => {
    expect(nimProvider.endpointTypes).toContain("nim");
    expect(nimProvider.endpointTypes).toContain("nim-cloud");
  });

  it("curatedModels contains expected entries", () => {
    expect(NIM_CURATED_MODELS.length).toBeGreaterThan(0);
    const ids = NIM_CURATED_MODELS.map((m) => m.id);
    expect(ids).toContain("nvidia/nemotron-3-super-120b-a12b");
    expect(ids).toContain("nvidia/llama-3.1-nemotron-ultra-253b-v1");
  });

  it("requiredEnvVars includes NGC_API_KEY", () => {
    expect(nimProvider.requiredEnvVars).toContain("NGC_API_KEY");
  });

  it("optionalEnvVars includes NIM_VERSION", () => {
    expect(nimProvider.optionalEnvVars).toContain("NIM_VERSION");
  });
});

// ---------------------------------------------------------------------------
// resolveEndpointUrl
// ---------------------------------------------------------------------------

describe("resolveEndpointUrl", () => {
  it("returns provided endpoint URL (trimming trailing slashes)", async () => {
    const url = await nimProvider.resolveEndpointUrl({
      endpointType: "nim",
      endpointUrl: "http://nim-host:8000/v1/",
      nonInteractive: true,
    });
    expect(url).toBe("http://nim-host:8000/v1");
  });

  it("returns cloud endpoint for nim-cloud type", async () => {
    const url = await nimProvider.resolveEndpointUrl({
      endpointType: "nim-cloud",
      nonInteractive: true,
    });
    expect(url).toBe("https://integrate.api.nvidia.com/v1");
  });

  it("uses explicit URL over nim-cloud type", async () => {
    const url = await nimProvider.resolveEndpointUrl({
      endpointType: "nim-cloud",
      endpointUrl: "http://custom:8000/v1",
      nonInteractive: true,
    });
    expect(url).toBe("http://custom:8000/v1");
  });
});

// ---------------------------------------------------------------------------
// validateCredentials
// ---------------------------------------------------------------------------

describe("validateCredentials", () => {
  it("returns true on successful validation", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, models: [], error: null });
    const result = await nimProvider.validateCredentials("ngc-key", "https://integrate.api.nvidia.com/v1");
    expect(result).toBe(true);
    expect(validateApiKey).toHaveBeenCalledWith("ngc-key", "https://integrate.api.nvidia.com/v1");
  });

  it("returns false on failed validation", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: false, models: [], error: "unauthorized" });
    const result = await nimProvider.validateCredentials("bad-key", "https://integrate.api.nvidia.com/v1");
    expect(result).toBe(false);
  });

  it("works with self-hosted endpoint", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, models: ["my-model"], error: null });
    const result = await nimProvider.validateCredentials("local-key", "http://nim-service:8000/v1");
    expect(result).toBe(true);
    expect(validateApiKey).toHaveBeenCalledWith("local-key", "http://nim-service:8000/v1");
  });
});

// ---------------------------------------------------------------------------
// discoverModels
// ---------------------------------------------------------------------------

describe("discoverModels", () => {
  it("uses standard /models for self-hosted endpoints", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({
      valid: true,
      models: ["custom/model-a", "custom/model-b"],
      error: null,
    });
    const models = await nimProvider.discoverModels("key", "http://nim-host:8000/v1");
    expect(models).toEqual(["custom/model-a", "custom/model-b"]);
    expect(validateApiKey).toHaveBeenCalledWith("key", "http://nim-host:8000/v1");
  });

  it("uses catalog for cloud endpoint, falls back to validateApiKey on empty catalog", async () => {
    // fetchNimCatalog will use global fetch — mock it to return empty
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    vi.mocked(validateApiKey).mockResolvedValue({
      valid: true,
      models: ["nvidia/fallback-model"],
      error: null,
    });

    const models = await nimProvider.discoverModels("key", "https://integrate.api.nvidia.com/v1");
    expect(models).toEqual(["nvidia/fallback-model"]);
    fetchSpy.mockRestore();
  });

  it("uses catalog results for cloud endpoint when available", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: "nvidia/nemotron-3-super-120b-a12b", name: "Nemotron 3 Super" },
            { id: "meta/llama-3.1-8b", name: "Llama 3.1 8B", license: "community" },
          ],
        }),
        { status: 200 },
      ),
    );

    const models = await nimProvider.discoverModels("key", "https://integrate.api.nvidia.com/v1");
    expect(models).toEqual(["nvidia/nemotron-3-super-120b-a12b", "meta/llama-3.1-8b"]);
    expect(validateApiKey).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// fetchNimCatalog + cache
// ---------------------------------------------------------------------------

describe("fetchNimCatalog", () => {
  afterEach(() => {
    clearCatalogCache();
  });

  it("parses catalog response into NimModel[]", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: "nvidia/model-a", name: "Model A", license: "enterprise", versions: ["1.0", "1.1"] },
            { id: "nvidia/model-b" },
          ],
        }),
        { status: 200 },
      ),
    );

    const catalog = await fetchNimCatalog("https://integrate.api.nvidia.com/v1", "ngc-key");
    expect(catalog).toHaveLength(2);
    expect(catalog[0]).toEqual({
      id: "nvidia/model-a",
      name: "Model A",
      license: "enterprise",
      versions: ["1.0", "1.1"],
    });
    expect(catalog[1]).toEqual({
      id: "nvidia/model-b",
      name: "nvidia/model-b",
      license: "community",
      versions: [],
    });
    fetchSpy.mockRestore();
  });

  it("returns empty array on HTTP error", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );
    const catalog = await fetchNimCatalog("https://integrate.api.nvidia.com/v1", "bad-key");
    expect(catalog).toEqual([]);
    fetchSpy.mockRestore();
  });

  it("returns empty array on network error", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));
    const catalog = await fetchNimCatalog("http://unreachable:8000/v1", "key");
    expect(catalog).toEqual([]);
    fetchSpy.mockRestore();
  });

  it("caches results and does not re-fetch within TTL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: "nvidia/cached-model" }] }),
        { status: 200 },
      ),
    );

    const first = await fetchNimCatalog("https://integrate.api.nvidia.com/v1", "ngc-key");
    const second = await fetchNimCatalog("https://integrate.api.nvidia.com/v1", "ngc-key");

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // cached — only one fetch
    fetchSpy.mockRestore();
  });

  it("re-fetches after cache is cleared", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: "nvidia/model" }] }),
        { status: 200 },
      ),
    );

    await fetchNimCatalog("https://integrate.api.nvidia.com/v1", "ngc-key");
    clearCatalogCache();
    await fetchNimCatalog("https://integrate.api.nvidia.com/v1", "ngc-key");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    fetchSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// buildModelOptions
// ---------------------------------------------------------------------------

describe("buildModelOptions", () => {
  it("filters discovered models against curated list", () => {
    const discovered = ["nvidia/nemotron-3-super-120b-a12b", "other/model"];
    const options = nimProvider.buildModelOptions(discovered);
    expect(options).toHaveLength(1);
    expect(options[0].id).toBe("nvidia/nemotron-3-super-120b-a12b");
  });

  it("returns discovered models directly when no curated match", () => {
    const options = nimProvider.buildModelOptions(["custom/model-x", "custom/model-y"]);
    expect(options).toEqual([
      { id: "custom/model-x", label: "custom/model-x" },
      { id: "custom/model-y", label: "custom/model-y" },
    ]);
  });

  it("falls back to all curated when discovered is empty", () => {
    const options = nimProvider.buildModelOptions([]);
    expect(options.length).toBe(NIM_CURATED_MODELS.length);
  });
});

// ---------------------------------------------------------------------------
// defaultModelId
// ---------------------------------------------------------------------------

describe("defaultModelId", () => {
  it("prefers curated model when present in discovered", () => {
    const result = nimProvider.defaultModelId(["other/model", "nvidia/nemotron-3-super-120b-a12b"]);
    expect(result).toBe("nvidia/nemotron-3-super-120b-a12b");
  });

  it("falls back to first discovered when no curated match", () => {
    const result = nimProvider.defaultModelId(["custom/model-a"]);
    expect(result).toBe("custom/model-a");
  });

  it("falls back to first curated when discovered is empty", () => {
    const result = nimProvider.defaultModelId([]);
    expect(result).toBe(NIM_CURATED_MODELS[0].id);
  });
});

// ---------------------------------------------------------------------------
// toProviderPlugin
// ---------------------------------------------------------------------------

describe("toProviderPlugin", () => {
  it("with model returns single model entry", () => {
    const plugin = nimProvider.toProviderPlugin("nvidia/test-model", "NGC_API_KEY");
    expect(plugin.id).toBe("inference");
    expect(plugin.label).toBe("Managed Inference Route");
    expect(plugin.auth).toHaveLength(1);
    expect(plugin.auth[0].envVar).toBe("NGC_API_KEY");
    expect(plugin.models?.chat).toHaveLength(1);
    expect(plugin.models?.chat?.[0].id).toBe("inference/nvidia/test-model");
  });

  it("with null model returns default catalog", () => {
    const plugin = nimProvider.toProviderPlugin(null, "NGC_API_KEY");
    const chatModels = plugin.models?.chat ?? [];
    expect(chatModels.length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// toBlueprintProfile
// ---------------------------------------------------------------------------

describe("toBlueprintProfile", () => {
  it("returns nvidia provider_type with cloud endpoint", () => {
    const profile = nimProvider.toBlueprintProfile("nvidia/test-model", "NGC_API_KEY");
    expect(profile).toEqual({
      provider_type: "nvidia",
      provider_name: "nvidia-nim",
      endpoint: "https://integrate.api.nvidia.com/v1",
      model: "nvidia/test-model",
      credential_env: "NGC_API_KEY",
    });
  });

  it("conforms to InferenceProfileConfig shape", () => {
    const profile = nimProvider.toBlueprintProfile("model", "ENV");
    expect(typeof profile.provider_type).toBe("string");
    expect(typeof profile.provider_name).toBe("string");
    expect(typeof profile.endpoint).toBe("string");
    expect(typeof profile.model).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// toOpenShellProviderConfig
// ---------------------------------------------------------------------------

describe("toOpenShellProviderConfig", () => {
  it("returns openai provider config with NGC credential", () => {
    const config = nimProvider.toOpenShellProviderConfig(
      "ngc-test-key",
      "https://integrate.api.nvidia.com/v1",
    );
    expect(config.type).toBe("openai");
    expect(config.credentialEnvRefs).toEqual({ NGC_API_KEY: "NGC_API_KEY" });
    expect(config.config).toEqual({
      OPENAI_BASE_URL: "https://integrate.api.nvidia.com/v1",
    });
  });

  it("works with self-hosted endpoint", () => {
    const config = nimProvider.toOpenShellProviderConfig("local-key", "http://nim:8000/v1");
    expect(config.config).toEqual({ OPENAI_BASE_URL: "http://nim:8000/v1" });
  });
});

// ---------------------------------------------------------------------------
// describeProvider / wizardHint
// ---------------------------------------------------------------------------

describe("describeProvider / wizardHint", () => {
  it("describeProvider returns correct label", () => {
    expect(nimProvider.describeProvider()).toBe("NVIDIA NIM");
  });

  it("wizardHint returns expected text", () => {
    expect(nimProvider.wizardHint({ ollamaInstalled: false, ollamaRunning: false })).toBe(
      "NVIDIA NIM — cloud or self-hosted inference",
    );
  });
});
