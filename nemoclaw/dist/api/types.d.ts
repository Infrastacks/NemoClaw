/**
 * TypeScript interfaces matching the Pydantic models in orchestrator/models.py.
 */
export interface HealthResponse {
    status: string;
    version: string;
}
export interface PlanResponse {
    run_id: string;
    profile: string;
    sandbox: Record<string, unknown>;
    inference: Record<string, unknown>;
    policy_additions?: Record<string, unknown> | null;
    dry_run: boolean;
}
export interface ApplyResponse {
    run_id: string;
    sandbox_name: string;
    message: string;
}
export interface RunStatusResponse {
    run_id: string;
    profile?: string | null;
    sandbox_name?: string | null;
    inference?: Record<string, unknown> | null;
    timestamp?: string | null;
    status?: string | null;
}
export interface RollbackResponse {
    run_id: string;
    message: string;
}
export interface BlueprintSummary {
    version: string;
    description: string;
    profiles: string[];
}
export interface BlueprintDescribeResponse {
    version: string;
    description: string;
    profiles: string[];
    sandbox: Record<string, unknown>;
    min_openshell: string;
    min_openclaw: string;
}
export interface ApiError {
    error: string;
    code: string;
    detail?: string | null;
}
export interface PlanRequest {
    profile?: string;
    dry_run?: boolean;
    endpoint_url?: string | null;
}
export interface ApplyRequest {
    profile?: string;
    plan_path?: string | null;
    endpoint_url?: string | null;
}
//# sourceMappingURL=types.d.ts.map