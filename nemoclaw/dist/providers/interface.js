"use strict";
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.createProviderPlugin = createProviderPlugin;
exports.createOpenShellProviderConfig = createOpenShellProviderConfig;
/** Shared helper: builds the ProviderPlugin shape that OpenClaw expects. */
function createProviderPlugin(model, credentialEnv, defaultModels) {
    const authLabel = credentialEnv === "NVIDIA_API_KEY"
        ? `NVIDIA API Key (${credentialEnv})`
        : `OpenAI API Key (${credentialEnv})`;
    const chatModels = model
        ? [{ id: `inference/${model}`, label: model, contextWindow: 131072, maxOutput: 8192 }]
        : defaultModels;
    return {
        id: "inference",
        label: "Managed Inference Route",
        aliases: ["inference-local", "nemoclaw"],
        envVars: [credentialEnv],
        models: { chat: chatModels },
        auth: [{ type: "bearer", envVar: credentialEnv, headerName: "Authorization", label: authLabel }],
    };
}
function createOpenShellProviderConfig(type, credentialKey, credentialValue, endpointUrl, options) {
    const useEnvRef = options?.useEnvRef ?? false;
    return {
        type,
        credentials: useEnvRef ? undefined : { [credentialKey]: credentialValue },
        credentialEnvRefs: useEnvRef ? { [credentialKey]: credentialValue } : undefined,
        config: { OPENAI_BASE_URL: endpointUrl },
    };
}
//# sourceMappingURL=interface.js.map