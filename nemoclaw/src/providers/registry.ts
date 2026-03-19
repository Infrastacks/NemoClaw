// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { InferenceProvider } from "./interface.js";

export class ProviderRegistry {
  private providers = new Map<string, InferenceProvider>();

  register(provider: InferenceProvider): void {
    this.providers.set(provider.id, provider);
    for (const type of provider.endpointTypes) {
      this.providers.set(type, provider);
    }
  }

  get(id: string): InferenceProvider | undefined {
    return this.providers.get(id);
  }

  list(): InferenceProvider[] {
    const seen = new Set<string>();
    const result: InferenceProvider[] = [];
    for (const provider of this.providers.values()) {
      if (!seen.has(provider.id)) {
        seen.add(provider.id);
        result.push(provider);
      }
    }
    return result;
  }

  resolve(endpointType: string): InferenceProvider {
    const provider = this.providers.get(endpointType);
    if (!provider) {
      throw new Error(`Unknown endpoint type: ${endpointType}`);
    }
    return provider;
  }
}
