"use strict";
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.vllmProvider = void 0;
const interface_js_1 = require("./interface.js");
const validate_js_1 = require("../onboard/validate.js");
const HOST_GATEWAY = "http://host.openshell.internal";
exports.vllmProvider = {
    id: "vllm",
    label: "Local vLLM [experimental]",
    endpointTypes: ["vllm"],
    profileName: "vllm",
    providerName: "vllm-local",
    credentialEnvVar: "OPENAI_API_KEY",
    requiresApiKey: false,
    defaultCredential: "dummy",
    defaultEndpoint: `${HOST_GATEWAY}:8000/v1`,
    isLocal: true,
    isExperimental: true,
    curatedModels: [],
    requiredEnvVars: [],
    optionalEnvVars: ["OPENAI_API_KEY"],
    wizardHint() {
        return "experimental — local development";
    },
    async resolveEndpointUrl() {
        return `${HOST_GATEWAY}:8000/v1`;
    },
    async resolveExtraConfig() {
        return {};
    },
    async discoverModels(apiKey, endpointUrl) {
        const result = await (0, validate_js_1.validateApiKey)(apiKey, endpointUrl);
        return result.models;
    },
    buildModelOptions(discoveredModels) {
        return discoveredModels.map((id) => ({ id, label: id }));
    },
    defaultModelId(discoveredModels) {
        return discoveredModels[0] ?? "";
    },
    toProviderPlugin(model, credentialEnv) {
        return (0, interface_js_1.createProviderPlugin)(model, credentialEnv, []);
    },
    describeProvider() {
        return "Local vLLM";
    },
};
//# sourceMappingURL=vllm.js.map