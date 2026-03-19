"use strict";
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProviderRegistry = void 0;
class ProviderRegistry {
    providers = new Map();
    register(provider) {
        this.providers.set(provider.id, provider);
        for (const type of provider.endpointTypes) {
            this.providers.set(type, provider);
        }
    }
    get(id) {
        return this.providers.get(id);
    }
    list() {
        const seen = new Set();
        const result = [];
        for (const provider of this.providers.values()) {
            if (!seen.has(provider.id)) {
                seen.add(provider.id);
                result.push(provider);
            }
        }
        return result;
    }
    resolve(endpointType) {
        const provider = this.providers.get(endpointType);
        if (!provider) {
            throw new Error(`Unknown endpoint type: ${endpointType}`);
        }
        return provider;
    }
}
exports.ProviderRegistry = ProviderRegistry;
//# sourceMappingURL=registry.js.map