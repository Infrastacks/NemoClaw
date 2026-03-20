export type { InferenceProvider, InferenceProfileConfig, ProviderType, ModelOption, WizardContext, EndpointResolutionContext, } from "./interface.js";
export { createProviderPlugin } from "./interface.js";
export { ProviderRegistry } from "./registry.js";
export { nvidiaBuildProvider, CURATED_MODELS } from "./nvidia-build.js";
export { nvidiaNcpProvider } from "./nvidia-ncp.js";
export { nimLocalProvider } from "./nim-local.js";
export { vllmProvider } from "./vllm.js";
export { ollamaProvider, detectOllama, parseOllamaList } from "./ollama.js";
export { azureOpenAIProvider } from "./azure-openai.js";
import { ProviderRegistry } from "./registry.js";
export declare function createDefaultRegistry(): ProviderRegistry;
//# sourceMappingURL=index.d.ts.map