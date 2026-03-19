import type { InferenceProvider } from "./interface.js";
export declare function detectOllama(): {
    installed: boolean;
    running: boolean;
};
export declare function parseOllamaList(output: string): string[];
export declare const ollamaProvider: InferenceProvider;
//# sourceMappingURL=ollama.d.ts.map