"use strict";
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.BlueprintApiClient = exports.BlueprintApiError = void 0;
class BlueprintApiError extends Error {
    statusCode;
    apiError;
    constructor(statusCode, apiError) {
        super(`${apiError.code}: ${apiError.error}`);
        this.name = "BlueprintApiError";
        this.statusCode = statusCode;
        this.apiError = apiError;
    }
}
exports.BlueprintApiError = BlueprintApiError;
class BlueprintApiClient {
    baseUrl;
    constructor(baseUrl = "http://127.0.0.1:18790") {
        // Strip trailing slash
        this.baseUrl = baseUrl.replace(/\/+$/, "");
    }
    async request(method, path, body) {
        const url = `${this.baseUrl}${path}`;
        const init = {
            method,
            headers: { "Content-Type": "application/json" },
        };
        if (body !== undefined) {
            init.body = JSON.stringify(body);
        }
        const resp = await fetch(url, init);
        if (!resp.ok) {
            let apiError;
            try {
                const json = (await resp.json());
                // FastAPI wraps HTTPException detail in a "detail" envelope
                apiError = (json.detail ?? json);
            }
            catch {
                apiError = { error: resp.statusText, code: "UNKNOWN" };
            }
            throw new BlueprintApiError(resp.status, apiError);
        }
        return (await resp.json());
    }
    async health() {
        return this.request("GET", "/health");
    }
    async plan(req = {}) {
        return this.request("POST", "/v1/blueprints/plan", req);
    }
    async apply(req = {}) {
        return this.request("POST", "/v1/blueprints/apply", req);
    }
    async listRuns() {
        return this.request("GET", "/v1/runs");
    }
    async getRun(runId) {
        return this.request("GET", `/v1/runs/${encodeURIComponent(runId)}`);
    }
    async rollback(runId) {
        return this.request("POST", `/v1/runs/${encodeURIComponent(runId)}/rollback`);
    }
    async listBlueprints() {
        return this.request("GET", "/v1/blueprints");
    }
    async getBlueprint(version) {
        return this.request("GET", `/v1/blueprints/${encodeURIComponent(version)}`);
    }
    async describeBlueprint() {
        return this.getBlueprint("current");
    }
}
exports.BlueprintApiClient = BlueprintApiClient;
//# sourceMappingURL=client.js.map