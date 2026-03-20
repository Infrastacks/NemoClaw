"use strict";
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.nvidiaNcpProvider = void 0;
const interface_js_1 = require("./interface.js");
const validate_js_1 = require("../onboard/validate.js");
const prompt_js_1 = require("../onboard/prompt.js");
const nvidia_build_js_1 = require("./nvidia-build.js");
exports.nvidiaNcpProvider = {
    id: "ncp",
    label: "NVIDIA Cloud Partner (NCP)",
    endpointTypes: ["ncp", "custom"],
    profileName: "ncp",
    providerName: "nvidia-ncp",
    credentialEnvVar: "NVIDIA_API_KEY",
    requiresApiKey: true,
    defaultCredential: "",
    defaultEndpoint: "",
    providerType: "nvidia",
    isLocal: false,
    isExperimental: false,
    curatedModels: nvidia_build_js_1.CURATED_MODELS,
    requiredEnvVars: ["NVIDIA_API_KEY"],
    optionalEnvVars: [],
    wizardHint() {
        return "dedicated capacity, SLA-backed";
    },
    async resolveEndpointUrl(ctx) {
        if (ctx.endpointUrl)
            return ctx.endpointUrl;
        if (ctx.endpointType === "custom") {
            return (0, prompt_js_1.promptInput)("Custom endpoint URL");
        }
        return (0, prompt_js_1.promptInput)("NCP endpoint URL (e.g., https://partner.api.nvidia.com/v1)");
    },
    async resolveExtraConfig(ctx) {
        if (ctx.endpointType !== "ncp")
            return {};
        const ncpPartner = ctx.ncpPartner ?? (await (0, prompt_js_1.promptInput)("NCP partner name"));
        return { ncpPartner };
    },
    async discoverModels(apiKey, endpointUrl) {
        const result = await (0, validate_js_1.validateApiKey)(apiKey, endpointUrl);
        return result.models;
    },
    buildModelOptions(discoveredModels) {
        const curated = nvidia_build_js_1.CURATED_MODELS.filter((m) => discoveredModels.includes(m.id)).map((m) => ({
            id: m.id,
            label: `${m.label} (${m.id})`,
        }));
        if (curated.length > 0)
            return curated;
        return nvidia_build_js_1.CURATED_MODELS.map((m) => ({ id: m.id, label: `${m.label} (${m.id})` }));
    },
    defaultModelId(discoveredModels) {
        const first = nvidia_build_js_1.CURATED_MODELS.find((m) => discoveredModels.includes(m.id));
        return first?.id ?? nvidia_build_js_1.CURATED_MODELS[0].id;
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
            provider_type: "nvidia",
            provider_name: this.providerName,
            endpoint: "",
            model,
            credential_env: credentialEnv,
            dynamic_endpoint: true,
        };
    },
    describeProvider() {
        return "NVIDIA Cloud Partner";
    },
};
//# sourceMappingURL=nvidia-ncp.js.map