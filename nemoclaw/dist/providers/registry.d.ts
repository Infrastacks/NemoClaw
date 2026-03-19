import type { InferenceProvider } from "./interface.js";
export declare class ProviderRegistry {
    private providers;
    register(provider: InferenceProvider): void;
    get(id: string): InferenceProvider | undefined;
    list(): InferenceProvider[];
    resolve(endpointType: string): InferenceProvider;
}
//# sourceMappingURL=registry.d.ts.map