import type { InferenceProvider, ModelOption } from "./interface.js";
export interface NimModel {
    id: string;
    name: string;
    license: "community" | "enterprise" | "research";
    versions: string[];
}
export declare function clearCatalogCache(): void;
export declare const NIM_CURATED_MODELS: ModelOption[];
export declare function fetchNimCatalog(endpointUrl: string, apiKey: string): Promise<NimModel[]>;
export declare const nimProvider: InferenceProvider;
//# sourceMappingURL=nim.d.ts.map