"use strict";
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.azureOpenAIProvider = exports.parseOllamaList = exports.detectOllama = exports.ollamaProvider = exports.vllmProvider = exports.nimLocalProvider = exports.nvidiaNcpProvider = exports.CURATED_MODELS = exports.nvidiaBuildProvider = exports.ProviderRegistry = exports.createProviderPlugin = void 0;
exports.createDefaultRegistry = createDefaultRegistry;
var interface_js_1 = require("./interface.js");
Object.defineProperty(exports, "createProviderPlugin", { enumerable: true, get: function () { return interface_js_1.createProviderPlugin; } });
var registry_js_1 = require("./registry.js");
Object.defineProperty(exports, "ProviderRegistry", { enumerable: true, get: function () { return registry_js_1.ProviderRegistry; } });
var nvidia_build_js_1 = require("./nvidia-build.js");
Object.defineProperty(exports, "nvidiaBuildProvider", { enumerable: true, get: function () { return nvidia_build_js_1.nvidiaBuildProvider; } });
Object.defineProperty(exports, "CURATED_MODELS", { enumerable: true, get: function () { return nvidia_build_js_1.CURATED_MODELS; } });
var nvidia_ncp_js_1 = require("./nvidia-ncp.js");
Object.defineProperty(exports, "nvidiaNcpProvider", { enumerable: true, get: function () { return nvidia_ncp_js_1.nvidiaNcpProvider; } });
var nim_local_js_1 = require("./nim-local.js");
Object.defineProperty(exports, "nimLocalProvider", { enumerable: true, get: function () { return nim_local_js_1.nimLocalProvider; } });
var vllm_js_1 = require("./vllm.js");
Object.defineProperty(exports, "vllmProvider", { enumerable: true, get: function () { return vllm_js_1.vllmProvider; } });
var ollama_js_1 = require("./ollama.js");
Object.defineProperty(exports, "ollamaProvider", { enumerable: true, get: function () { return ollama_js_1.ollamaProvider; } });
Object.defineProperty(exports, "detectOllama", { enumerable: true, get: function () { return ollama_js_1.detectOllama; } });
Object.defineProperty(exports, "parseOllamaList", { enumerable: true, get: function () { return ollama_js_1.parseOllamaList; } });
var azure_openai_js_1 = require("./azure-openai.js");
Object.defineProperty(exports, "azureOpenAIProvider", { enumerable: true, get: function () { return azure_openai_js_1.azureOpenAIProvider; } });
const registry_js_2 = require("./registry.js");
const nvidia_build_js_2 = require("./nvidia-build.js");
const nvidia_ncp_js_2 = require("./nvidia-ncp.js");
const nim_local_js_2 = require("./nim-local.js");
const vllm_js_2 = require("./vllm.js");
const ollama_js_2 = require("./ollama.js");
const azure_openai_js_2 = require("./azure-openai.js");
function createDefaultRegistry() {
    const registry = new registry_js_2.ProviderRegistry();
    registry.register(nvidia_build_js_2.nvidiaBuildProvider);
    registry.register(nvidia_ncp_js_2.nvidiaNcpProvider);
    registry.register(azure_openai_js_2.azureOpenAIProvider);
    registry.register(nim_local_js_2.nimLocalProvider);
    registry.register(vllm_js_2.vllmProvider);
    registry.register(ollama_js_2.ollamaProvider);
    return registry;
}
//# sourceMappingURL=index.js.map