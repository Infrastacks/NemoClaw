// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process to prevent actual shell calls from ollama provider
vi.mock("node:child_process", () => ({
  execSync: vi.fn(() => ""),
  execFileSync: vi.fn(() => ""),
}));

// Mock validate.ts to prevent actual network calls
vi.mock("../onboard/validate.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../onboard/validate.js")>();
  return {
    ...actual,
    validateApiKey: vi.fn(),
  };
});

const { execSync } = await import("node:child_process");
const { validateApiKey } = await import("../onboard/validate.js");

const { nvidiaBuildProvider, CURATED_MODELS } = await import("./nvidia-build.js");
const { nvidiaNcpProvider } = await import("./nvidia-ncp.js");
const { nimLocalProvider } = await import("./nim-local.js");
const { vllmProvider } = await import("./vllm.js");
const { ollamaProvider, parseOllamaList } = await import("./ollama.js");
const { azureOpenAIProvider } = await import("./azure-openai.js");

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// nvidia-build
// ---------------------------------------------------------------------------

describe("nvidia-build provider", () => {
  it("has correct static properties", () => {
    expect(nvidiaBuildProvider.id).toBe("build");
    expect(nvidiaBuildProvider.profileName).toBe("default");
    expect(nvidiaBuildProvider.providerName).toBe("nvidia-nim");
    expect(nvidiaBuildProvider.credentialEnvVar).toBe("NVIDIA_API_KEY");
    expect(nvidiaBuildProvider.requiresApiKey).toBe(true);
    expect(nvidiaBuildProvider.defaultEndpoint).toBe("https://integrate.api.nvidia.com/v1");
    expect(nvidiaBuildProvider.isExperimental).toBe(false);
    expect(nvidiaBuildProvider.isLocal).toBe(false);
    expect(nvidiaBuildProvider.providerType).toBe("nvidia");
  });

  it("curatedModels contains expected entries", () => {
    expect(CURATED_MODELS.length).toBeGreaterThan(0);
    const ids = CURATED_MODELS.map((m) => m.id);
    expect(ids).toContain("nvidia/nemotron-3-super-120b-a12b");
  });

  it("buildModelOptions filters by discovered models", () => {
    const discovered = ["nvidia/nemotron-3-super-120b-a12b", "other/model"];
    const options = nvidiaBuildProvider.buildModelOptions(discovered);
    expect(options).toHaveLength(1);
    expect(options[0].id).toBe("nvidia/nemotron-3-super-120b-a12b");
  });

  it("buildModelOptions falls back to all curated when none match", () => {
    const options = nvidiaBuildProvider.buildModelOptions(["unknown/model"]);
    expect(options.length).toBe(CURATED_MODELS.length);
  });

  it("toProviderPlugin with model returns single model entry", () => {
    const plugin = nvidiaBuildProvider.toProviderPlugin("nvidia/test-model", "NVIDIA_API_KEY");
    expect(plugin.id).toBe("inference");
    expect(plugin.label).toBe("Managed Inference Route");
    expect(plugin.auth).toHaveLength(1);
    expect(plugin.auth[0].envVar).toBe("NVIDIA_API_KEY");
    expect(plugin.auth[0].label).toContain("NVIDIA API Key");
    expect(plugin.models?.chat).toHaveLength(1);
    expect(plugin.models?.chat?.[0].id).toBe("inference/nvidia/test-model");
  });

  it("toProviderPlugin with null model returns default catalog", () => {
    const plugin = nvidiaBuildProvider.toProviderPlugin(null, "NVIDIA_API_KEY");
    const chatModels = plugin.models?.chat ?? [];
    expect(chatModels.length).toBeGreaterThan(1);
    expect(chatModels[0].id).toBe("nvidia/nemotron-3-super-120b-a12b");
  });

  it("describeProvider returns correct label", () => {
    expect(nvidiaBuildProvider.describeProvider()).toBe("NVIDIA Cloud API");
  });
});

// ---------------------------------------------------------------------------
// nvidia-ncp
// ---------------------------------------------------------------------------

describe("nvidia-ncp provider", () => {
  it("has correct static properties", () => {
    expect(nvidiaNcpProvider.id).toBe("ncp");
    expect(nvidiaNcpProvider.profileName).toBe("ncp");
    expect(nvidiaNcpProvider.providerName).toBe("nvidia-ncp");
    expect(nvidiaNcpProvider.credentialEnvVar).toBe("NVIDIA_API_KEY");
    expect(nvidiaNcpProvider.requiresApiKey).toBe(true);
    expect(nvidiaNcpProvider.defaultEndpoint).toBe("");
    expect(nvidiaNcpProvider.isExperimental).toBe(false);
    expect(nvidiaNcpProvider.isLocal).toBe(false);
    expect(nvidiaNcpProvider.providerType).toBe("nvidia");
  });

  it("endpointTypes includes both ncp and custom", () => {
    expect(nvidiaNcpProvider.endpointTypes).toContain("ncp");
    expect(nvidiaNcpProvider.endpointTypes).toContain("custom");
  });

  it("shares curatedModels with nvidia-build", () => {
    expect(nvidiaNcpProvider.curatedModels).toBe(CURATED_MODELS);
  });

  it("toProviderPlugin returns valid shape", () => {
    const plugin = nvidiaNcpProvider.toProviderPlugin("test-model", "NVIDIA_API_KEY");
    expect(plugin.id).toBe("inference");
    expect(plugin.auth[0].envVar).toBe("NVIDIA_API_KEY");
  });

  it("describeProvider returns correct label", () => {
    expect(nvidiaNcpProvider.describeProvider()).toBe("NVIDIA Cloud Partner");
  });
});

// ---------------------------------------------------------------------------
// nim-local
// ---------------------------------------------------------------------------

describe("nim-local provider", () => {
  it("has correct static properties", () => {
    expect(nimLocalProvider.id).toBe("nim-local");
    expect(nimLocalProvider.profileName).toBe("nim-local");
    expect(nimLocalProvider.providerName).toBe("nim-local");
    expect(nimLocalProvider.credentialEnvVar).toBe("NIM_API_KEY");
    expect(nimLocalProvider.requiresApiKey).toBe(true);
    expect(nimLocalProvider.defaultEndpoint).toBe("http://nim-service.local:8000/v1");
    expect(nimLocalProvider.isExperimental).toBe(true);
    expect(nimLocalProvider.isLocal).toBe(true);
    expect(nimLocalProvider.providerType).toBe("local");
  });

  it("toProviderPlugin returns valid shape", () => {
    const plugin = nimLocalProvider.toProviderPlugin("test-model", "NIM_API_KEY");
    expect(plugin.id).toBe("inference");
    expect(plugin.models?.chat).toHaveLength(1);
  });

  it("buildModelOptions maps ids to ModelOptions", () => {
    const options = nimLocalProvider.buildModelOptions(["model-a", "model-b"]);
    expect(options).toEqual([
      { id: "model-a", label: "model-a" },
      { id: "model-b", label: "model-b" },
    ]);
  });

  it("describeProvider returns correct label", () => {
    expect(nimLocalProvider.describeProvider()).toBe("Local NIM");
  });
});

// ---------------------------------------------------------------------------
// vllm
// ---------------------------------------------------------------------------

describe("vllm provider", () => {
  it("has correct static properties", () => {
    expect(vllmProvider.id).toBe("vllm");
    expect(vllmProvider.profileName).toBe("vllm");
    expect(vllmProvider.providerName).toBe("vllm-local");
    expect(vllmProvider.credentialEnvVar).toBe("OPENAI_API_KEY");
    expect(vllmProvider.requiresApiKey).toBe(false);
    expect(vllmProvider.defaultCredential).toBe("dummy");
    expect(vllmProvider.defaultEndpoint).toBe("http://host.openshell.internal:8000/v1");
    expect(vllmProvider.isExperimental).toBe(true);
    expect(vllmProvider.isLocal).toBe(true);
    expect(vllmProvider.providerType).toBe("local");
  });

  it("toProviderPlugin uses OpenAI auth label", () => {
    const plugin = vllmProvider.toProviderPlugin("test-model", "OPENAI_API_KEY");
    expect(plugin.id).toBe("inference");
    expect(plugin.auth[0].label).toContain("OpenAI API Key");
  });

  it("describeProvider returns correct label", () => {
    expect(vllmProvider.describeProvider()).toBe("Local vLLM");
  });
});

// ---------------------------------------------------------------------------
// ollama
// ---------------------------------------------------------------------------

describe("ollama provider", () => {
  it("has correct static properties", () => {
    expect(ollamaProvider.id).toBe("ollama");
    expect(ollamaProvider.profileName).toBe("ollama");
    expect(ollamaProvider.providerName).toBe("ollama-local");
    expect(ollamaProvider.credentialEnvVar).toBe("OPENAI_API_KEY");
    expect(ollamaProvider.requiresApiKey).toBe(false);
    expect(ollamaProvider.defaultCredential).toBe("ollama");
    expect(ollamaProvider.defaultEndpoint).toBe("http://host.openshell.internal:11434/v1");
    expect(ollamaProvider.isExperimental).toBe(false);
    expect(ollamaProvider.isLocal).toBe(true);
    expect(ollamaProvider.providerType).toBe("local");
  });

  it("parseOllamaList parses standard output", () => {
    const output =
      "NAME                    ID              SIZE      MODIFIED\nnemotron-3-nano:30b     abc123          16 GB     2 days ago\nllama3:8b               def456          4.7 GB    5 days ago\n";
    const models = parseOllamaList(output);
    expect(models).toEqual(["nemotron-3-nano:30b", "llama3:8b"]);
  });

  it("parseOllamaList handles empty output", () => {
    expect(parseOllamaList("")).toEqual([]);
  });

  it("parseOllamaList handles output with no header", () => {
    const output = "nemotron-3-nano:30b     abc123          16 GB     2 days ago\n";
    const models = parseOllamaList(output);
    expect(models).toEqual(["nemotron-3-nano:30b"]);
  });

  it("defaultModelId prefers default model when present", () => {
    vi.mocked(execSync).mockReturnValue("NAME\nnemotron-3-nano:30b\nllama3:8b\n");
    const result = ollamaProvider.defaultModelId(["nemotron-3-nano:30b", "llama3:8b"]);
    expect(result).toBe("nemotron-3-nano:30b");
  });

  it("defaultModelId falls back to first discovered model", () => {
    vi.mocked(execSync).mockReturnValue("NAME\nllama3:8b\n");
    const result = ollamaProvider.defaultModelId(["llama3:8b"]);
    expect(result).toBe("llama3:8b");
  });

  it("wizardHint reflects ollama running status", () => {
    expect(ollamaProvider.wizardHint({ ollamaInstalled: true, ollamaRunning: true })).toBe(
      "detected on localhost:11434",
    );
  });

  it("wizardHint reflects ollama installed status", () => {
    expect(ollamaProvider.wizardHint({ ollamaInstalled: true, ollamaRunning: false })).toBe(
      "installed locally",
    );
  });

  it("wizardHint shows default when ollama not installed", () => {
    expect(ollamaProvider.wizardHint({ ollamaInstalled: false, ollamaRunning: false })).toBe(
      "localhost:11434",
    );
  });

  it("toProviderPlugin returns valid shape", () => {
    const plugin = ollamaProvider.toProviderPlugin("nemotron-3-nano:30b", "OPENAI_API_KEY");
    expect(plugin.id).toBe("inference");
    expect(plugin.models?.chat).toHaveLength(1);
    expect(plugin.models?.chat?.[0].id).toBe("inference/nemotron-3-nano:30b");
  });

  it("describeProvider returns correct label", () => {
    expect(ollamaProvider.describeProvider()).toBe("Local Ollama");
  });
});

// ---------------------------------------------------------------------------
// azure-openai
// ---------------------------------------------------------------------------

describe("azure-openai provider", () => {
  it("has correct static properties", () => {
    expect(azureOpenAIProvider.id).toBe("azure");
    expect(azureOpenAIProvider.providerType).toBe("azure_openai");
    expect(azureOpenAIProvider.credentialEnvVar).toBe("AZURE_OPENAI_API_KEY");
    expect(azureOpenAIProvider.defaultEndpoint).toBe("");
    expect(azureOpenAIProvider.isExperimental).toBe(false);
    expect(azureOpenAIProvider.isLocal).toBe(false);
  });

  it("buildModelOptions maps directly", () => {
    const options = azureOpenAIProvider.buildModelOptions(["gpt-4o", "gpt-4o-mini"]);
    expect(options).toEqual([
      { id: "gpt-4o", label: "gpt-4o" },
      { id: "gpt-4o-mini", label: "gpt-4o-mini" },
    ]);
  });

  it("defaultModelId returns first or empty", () => {
    expect(azureOpenAIProvider.defaultModelId(["gpt-4o"])).toBe("gpt-4o");
    expect(azureOpenAIProvider.defaultModelId([])).toBe("");
  });

  it("toProviderPlugin uses api-key auth header", () => {
    const plugin = azureOpenAIProvider.toProviderPlugin("gpt-4o", "AZURE_OPENAI_API_KEY");
    expect(plugin.id).toBe("inference");
    expect(plugin.auth).toHaveLength(1);
    expect(plugin.auth[0].headerName).toBe("api-key");
    expect(plugin.auth[0].type).toBe("api-key");
    expect(plugin.auth[0].envVar).toBe("AZURE_OPENAI_API_KEY");
  });

  it("describeProvider returns Azure OpenAI", () => {
    expect(azureOpenAIProvider.describeProvider()).toBe("Azure OpenAI");
  });
});

// ---------------------------------------------------------------------------
// validateCredentials (Gap 2)
// ---------------------------------------------------------------------------

describe("validateCredentials", () => {
  it("nvidia-build returns true on successful validation", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, models: [] });
    const result = await nvidiaBuildProvider.validateCredentials("key", "https://endpoint/v1");
    expect(result).toBe(true);
    expect(validateApiKey).toHaveBeenCalledWith("key", "https://endpoint/v1");
  });

  it("nvidia-build returns false on failed validation", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: false, models: [] });
    const result = await nvidiaBuildProvider.validateCredentials("bad-key", "https://endpoint/v1");
    expect(result).toBe(false);
  });

  it("nvidia-ncp delegates to validateApiKey", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, models: [] });
    expect(await nvidiaNcpProvider.validateCredentials("key", "https://ncp/v1")).toBe(true);
  });

  it("nim-local delegates to validateApiKey", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, models: [] });
    expect(await nimLocalProvider.validateCredentials("key", "http://nim:8000/v1")).toBe(true);
  });

  it("vllm delegates to validateApiKey", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: false, models: [] });
    expect(await vllmProvider.validateCredentials("dummy", "http://host:8000/v1")).toBe(false);
  });

  it("azure delegates to validateApiKey with azure options", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, models: ["gpt-4o"], error: null });
    const result = await azureOpenAIProvider.validateCredentials("key", "https://my-resource.openai.azure.com");
    expect(result).toBe(true);
    expect(validateApiKey).toHaveBeenCalledWith(
      "key",
      "https://my-resource.openai.azure.com",
      expect.objectContaining({
        headers: { "api-key": "key" },
      }),
    );
  });

  it("ollama returns true when ollama is running", async () => {
    vi.mocked(execSync).mockImplementation(() => "");
    const result = await ollamaProvider.validateCredentials("", "");
    expect(result).toBe(true);
  });

  it("ollama returns false when ollama is not running", async () => {
    vi.mocked(execSync).mockImplementation((cmd) => {
      if (typeof cmd === "string" && cmd.includes("curl")) throw new Error("not running");
      return "";
    });
    const result = await ollamaProvider.validateCredentials("", "");
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toBlueprintProfile (Gap 3)
// ---------------------------------------------------------------------------

describe("toBlueprintProfile", () => {
  it("nvidia-build returns nvidia provider_type with endpoint", () => {
    const profile = nvidiaBuildProvider.toBlueprintProfile("nvidia/test-model", "NVIDIA_API_KEY");
    expect(profile).toEqual({
      provider_type: "nvidia",
      provider_name: "nvidia-nim",
      endpoint: "https://integrate.api.nvidia.com/v1",
      model: "nvidia/test-model",
      credential_env: "NVIDIA_API_KEY",
    });
  });

  it("nvidia-ncp returns dynamic_endpoint with empty endpoint", () => {
    const profile = nvidiaNcpProvider.toBlueprintProfile("nvidia/test-model", "NVIDIA_API_KEY");
    expect(profile.dynamic_endpoint).toBe(true);
    expect(profile.endpoint).toBe("");
    expect(profile.provider_type).toBe("nvidia");
  });

  it("nim-local returns openai provider_type", () => {
    const profile = nimLocalProvider.toBlueprintProfile("test-model", "NIM_API_KEY");
    expect(profile.provider_type).toBe("openai");
    expect(profile.endpoint).toBe("http://nim-service.local:8000/v1");
    expect(profile.provider_name).toBe("nim-local");
  });

  it("vllm returns credential_default dummy", () => {
    const profile = vllmProvider.toBlueprintProfile("test-model", "OPENAI_API_KEY");
    expect(profile.credential_default).toBe("dummy");
    expect(profile.provider_type).toBe("openai");
  });

  it("ollama returns credential_default ollama", () => {
    const profile = ollamaProvider.toBlueprintProfile("nemotron-3-nano:30b", "OPENAI_API_KEY");
    expect(profile.credential_default).toBe("ollama");
    expect(profile.provider_type).toBe("openai");
    expect(profile.provider_name).toBe("ollama-local");
  });

  it("azure returns dynamic_endpoint with openai provider_type", () => {
    const profile = azureOpenAIProvider.toBlueprintProfile("gpt-4o", "AZURE_OPENAI_API_KEY");
    expect(profile.dynamic_endpoint).toBe(true);
    expect(profile.provider_type).toBe("openai");
    expect(profile.endpoint).toBe("");
    expect(profile.credential_env).toBe("AZURE_OPENAI_API_KEY");
  });

  it("all profiles conform to InferenceProfileConfig shape", () => {
    const providers = [
      { p: nvidiaBuildProvider, model: "m", env: "E" },
      { p: nvidiaNcpProvider, model: "m", env: "E" },
      { p: nimLocalProvider, model: "m", env: "E" },
      { p: vllmProvider, model: "m", env: "E" },
      { p: ollamaProvider, model: "m", env: "E" },
      { p: azureOpenAIProvider, model: "m", env: "E" },
    ];
    for (const { p, model, env } of providers) {
      const profile = p.toBlueprintProfile(model, env);
      expect(typeof profile.provider_type).toBe("string");
      expect(typeof profile.provider_name).toBe("string");
      expect(typeof profile.endpoint).toBe("string");
      expect(typeof profile.model).toBe("string");
    }
  });
});
