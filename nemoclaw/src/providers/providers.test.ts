// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process to prevent actual shell calls from ollama provider
vi.mock("node:child_process", () => ({
  execSync: vi.fn(() => ""),
  execFileSync: vi.fn(() => ""),
}));

const { execSync } = await import("node:child_process");

const { nvidiaBuildProvider, CURATED_MODELS } = await import("./nvidia-build.js");
const { nvidiaNcpProvider } = await import("./nvidia-ncp.js");
const { nimLocalProvider } = await import("./nim-local.js");
const { vllmProvider } = await import("./vllm.js");
const { ollamaProvider, parseOllamaList } = await import("./ollama.js");

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
