// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { ProviderRegistry } from "./registry.js";
import { nvidiaBuildProvider } from "./nvidia-build.js";
import { nvidiaNcpProvider } from "./nvidia-ncp.js";
import { nimLocalProvider } from "./nim-local.js";
import { vllmProvider } from "./vllm.js";
import { ollamaProvider } from "./ollama.js";
import { createDefaultRegistry } from "./index.js";

describe("ProviderRegistry", () => {
  it("registers and retrieves a provider by id", () => {
    const registry = new ProviderRegistry();
    registry.register(nvidiaBuildProvider);
    expect(registry.get("build")).toBe(nvidiaBuildProvider);
  });

  it("retrieves a provider by endpointType alias", () => {
    const registry = new ProviderRegistry();
    registry.register(nvidiaNcpProvider);
    expect(registry.get("ncp")).toBe(nvidiaNcpProvider);
    expect(registry.get("custom")).toBe(nvidiaNcpProvider);
  });

  it("list() deduplicates providers registered under multiple types", () => {
    const registry = new ProviderRegistry();
    registry.register(nvidiaNcpProvider);
    const list = registry.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toBe(nvidiaNcpProvider);
  });

  it("resolve() returns the correct provider for each endpoint type", () => {
    const registry = createDefaultRegistry();
    expect(registry.resolve("build")).toBe(nvidiaBuildProvider);
    expect(registry.resolve("ncp")).toBe(nvidiaNcpProvider);
    expect(registry.resolve("custom")).toBe(nvidiaNcpProvider);
    expect(registry.resolve("nim-local")).toBe(nimLocalProvider);
    expect(registry.resolve("vllm")).toBe(vllmProvider);
    expect(registry.resolve("ollama")).toBe(ollamaProvider);
  });

  it("resolve() throws for unknown endpoint type", () => {
    const registry = new ProviderRegistry();
    expect(() => registry.resolve("unknown")).toThrow("Unknown endpoint type: unknown");
  });

  it("list() returns all registered providers without duplicates", () => {
    const registry = createDefaultRegistry();
    const list = registry.list();
    // 5 unique providers (ncp handles both "ncp" and "custom")
    expect(list).toHaveLength(5);
    const ids = list.map((p) => p.id);
    expect(ids).toContain("build");
    expect(ids).toContain("ncp");
    expect(ids).toContain("nim-local");
    expect(ids).toContain("vllm");
    expect(ids).toContain("ollama");
  });

  it("get() returns undefined for unregistered id", () => {
    const registry = new ProviderRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });
});
