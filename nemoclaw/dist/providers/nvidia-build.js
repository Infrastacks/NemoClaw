"use strict";
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.nvidiaBuildProvider = exports.CURATED_MODELS = void 0;
const interface_js_1 = require("./interface.js");
const validate_js_1 = require("../onboard/validate.js");
exports.CURATED_MODELS = [
    { id: "nvidia/nemotron-3-super-120b-a12b", label: "Nemotron 3 Super 120B" },
    { id: "moonshotai/kimi-k2.5", label: "Kimi K2.5" },
    { id: "z-ai/glm5", label: "GLM-5" },
    { id: "minimaxai/minimax-m2.5", label: "MiniMax M2.5" },
    { id: "qwen/qwen3.5-397b-a17b", label: "Qwen3.5 397B A17B" },
    { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
];
const DEFAULT_PLUGIN_MODELS = [
    {
        id: "nvidia/nemotron-3-super-120b-a12b",
        label: "Nemotron 3 Super 120B (March 2026)",
        contextWindow: 131072,
        maxOutput: 8192,
    },
    {
        id: "nvidia/llama-3.1-nemotron-ultra-253b-v1",
        label: "Nemotron Ultra 253B",
        contextWindow: 131072,
        maxOutput: 4096,
    },
    {
        id: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
        label: "Nemotron Super 49B v1.5",
        contextWindow: 131072,
        maxOutput: 4096,
    },
    {
        id: "nvidia/nemotron-3-nano-30b-a3b",
        label: "Nemotron 3 Nano 30B",
        contextWindow: 131072,
        maxOutput: 4096,
    },
];
exports.nvidiaBuildProvider = {
    id: "build",
    label: "NVIDIA Build (build.nvidia.com)",
    endpointTypes: ["build"],
    profileName: "default",
    providerName: "nvidia-nim",
    credentialEnvVar: "NVIDIA_API_KEY",
    requiresApiKey: true,
    defaultCredential: "",
    defaultEndpoint: "https://integrate.api.nvidia.com/v1",
    providerType: "nvidia",
    isLocal: false,
    isExperimental: false,
    curatedModels: exports.CURATED_MODELS,
    requiredEnvVars: ["NVIDIA_API_KEY"],
    optionalEnvVars: [],
    wizardHint() {
        return "recommended — zero infra, free credits";
    },
    async resolveEndpointUrl() {
        return "https://integrate.api.nvidia.com/v1";
    },
    async resolveExtraConfig() {
        return {};
    },
    async discoverModels(apiKey, endpointUrl) {
        const result = await (0, validate_js_1.validateApiKey)(apiKey, endpointUrl);
        return result.models;
    },
    buildModelOptions(discoveredModels) {
        const curated = exports.CURATED_MODELS.filter((m) => discoveredModels.includes(m.id)).map((m) => ({
            id: m.id,
            label: `${m.label} (${m.id})`,
        }));
        if (curated.length > 0)
            return curated;
        return exports.CURATED_MODELS.map((m) => ({ id: m.id, label: `${m.label} (${m.id})` }));
    },
    defaultModelId(discoveredModels) {
        const first = exports.CURATED_MODELS.find((m) => discoveredModels.includes(m.id));
        return first?.id ?? exports.CURATED_MODELS[0].id;
    },
    async validateCredentials(apiKey, endpointUrl) {
        const result = await (0, validate_js_1.validateApiKey)(apiKey, endpointUrl);
        return result.valid;
    },
    toProviderPlugin(model, credentialEnv) {
        return (0, interface_js_1.createProviderPlugin)(model, credentialEnv, DEFAULT_PLUGIN_MODELS);
    },
    toBlueprintProfile(model, credentialEnv) {
        return {
            provider_type: "nvidia",
            provider_name: this.providerName,
            endpoint: this.defaultEndpoint,
            model,
            credential_env: credentialEnv,
        };
    },
    toOpenShellProviderConfig(apiKey, endpointUrl) {
        return (0, interface_js_1.createOpenShellProviderConfig)("openai", this.credentialEnvVar, this.credentialEnvVar, endpointUrl, {
            useEnvRef: true,
        });
    },
    describeProvider() {
        return "NVIDIA Cloud API";
    },
};
//# sourceMappingURL=nvidia-build.js.map