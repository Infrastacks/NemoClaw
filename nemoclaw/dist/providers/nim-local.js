"use strict";
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.nimLocalProvider = void 0;
const interface_js_1 = require("./interface.js");
const validate_js_1 = require("../onboard/validate.js");
const prompt_js_1 = require("../onboard/prompt.js");
exports.nimLocalProvider = {
    id: "nim-local",
    label: "Self-hosted NIM [experimental]",
    endpointTypes: ["nim-local"],
    profileName: "nim-local",
    providerName: "nim-local",
    credentialEnvVar: "NIM_API_KEY",
    requiresApiKey: true,
    defaultCredential: "",
    defaultEndpoint: "http://nim-service.local:8000/v1",
    providerType: "local",
    isLocal: true,
    isExperimental: true,
    curatedModels: [],
    requiredEnvVars: ["NIM_API_KEY"],
    optionalEnvVars: [],
    wizardHint() {
        return "experimental — your own NIM container deployment";
    },
    async resolveEndpointUrl(ctx) {
        return ctx.endpointUrl ?? (await (0, prompt_js_1.promptInput)("NIM endpoint URL", "http://nim-service.local:8000/v1"));
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
    async validateCredentials(apiKey, endpointUrl) {
        const result = await (0, validate_js_1.validateApiKey)(apiKey, endpointUrl);
        return result.valid;
    },
    toProviderPlugin(model, credentialEnv) {
        return (0, interface_js_1.createProviderPlugin)(model, credentialEnv, []);
    },
    toBlueprintProfile(model, credentialEnv) {
        return {
            provider_type: "openai",
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
        return "Local NIM";
    },
};
//# sourceMappingURL=nim-local.js.map