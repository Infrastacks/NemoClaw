export interface ValidationResult {
    valid: boolean;
    models: string[];
    error: string | null;
}
export interface ValidateOptions {
    modelsUrl?: string;
    headers?: Record<string, string>;
}
export declare function azureValidateOptions(apiKey: string, endpointUrl: string): ValidateOptions;
export declare function validateApiKey(apiKey: string, endpointUrl: string, options?: ValidateOptions): Promise<ValidationResult>;
export declare function maskApiKey(apiKey: string): string;
//# sourceMappingURL=validate.d.ts.map