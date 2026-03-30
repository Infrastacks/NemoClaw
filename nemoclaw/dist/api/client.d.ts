/**
 * HTTP client for the NemoClaw Blueprint REST API.
 *
 * Uses native fetch (Node 20+). Zero additional npm dependencies.
 */
import type { ApiError, ApplyRequest, ApplyResponse, BlueprintDescribeResponse, BlueprintSummary, HealthResponse, PlanRequest, PlanResponse, RollbackResponse, RunStatusResponse } from "./types.js";
export declare class BlueprintApiError extends Error {
    readonly statusCode: number;
    readonly apiError: ApiError;
    constructor(statusCode: number, apiError: ApiError);
}
export declare class BlueprintApiClient {
    private readonly baseUrl;
    constructor(baseUrl?: string);
    private request;
    health(): Promise<HealthResponse>;
    plan(req?: PlanRequest): Promise<PlanResponse>;
    apply(req?: ApplyRequest): Promise<ApplyResponse>;
    listRuns(): Promise<RunStatusResponse[]>;
    getRun(runId: string): Promise<RunStatusResponse>;
    rollback(runId: string): Promise<RollbackResponse>;
    listBlueprints(): Promise<BlueprintSummary[]>;
    getBlueprint(version: string): Promise<BlueprintDescribeResponse>;
    describeBlueprint(): Promise<BlueprintDescribeResponse>;
}
//# sourceMappingURL=client.d.ts.map