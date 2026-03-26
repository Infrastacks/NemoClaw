import { execFile } from "node:child_process";
import { writeFile, unlink, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { log } from "./logger.js";
/** Serial async mutex — commands execute one at a time */
export class CommandHandler {
    queue = Promise.resolve();
    sandboxId;
    connection;
    nemoclaw;
    state;
    injectedCredentialKeys = [];
    lastCredentials;
    constructor(sandboxId, connection, nemoclaw, state) {
        this.sandboxId = sandboxId;
        this.connection = connection;
        this.nemoclaw = nemoclaw;
        this.state = state;
    }
    handle(cmd) {
        this.queue = this.queue.then(() => this.execute(cmd)).catch((err) => {
            log.error("Command execution failed", {
                command: cmd.type,
                error: err instanceof Error ? err.message : String(err),
            });
        });
    }
    async execute(cmd) {
        log.info("Executing command", { type: cmd.type });
        switch (cmd.type) {
            case "start":
                await this.handleStart(cmd.blueprintId, cmd.credentials);
                break;
            case "stop":
                await this.handleStop();
                break;
            case "restart":
                await this.handleRestart(cmd.blueprintId);
                break;
            case "update_blueprint":
                await this.handleUpdateBlueprint(cmd.blueprintId);
                break;
            case "update_policy":
                await this.handleUpdatePolicy(cmd.policies);
                break;
        }
    }
    async handleStart(blueprintId, credentials) {
        if (credentials !== undefined)
            this.lastCredentials = credentials;
        const prev = this.state.get().currentStatus;
        this.sendStatus(prev, "pending");
        this.state.update({ currentStatus: "pending", currentBlueprintId: blueprintId });
        this.injectCredentials(this.lastCredentials);
        try {
            const result = await this.nemoclaw.apply(blueprintId);
            this.state.update({ currentRunId: result.run_id, currentStatus: "running" });
            this.sendStatus("pending", "running");
            log.info("Sandbox started", { runId: result.run_id, blueprintId });
        }
        catch (err) {
            this.clearCredentials();
            this.state.update({ currentStatus: "error" });
            this.sendStatus("pending", "error");
            log.error("Start failed", { error: err instanceof Error ? err.message : String(err) });
        }
    }
    injectCredentials(credentials) {
        this.clearCredentials();
        if (!credentials)
            return;
        for (const [key, value] of Object.entries(credentials)) {
            process.env[key] = value;
            this.injectedCredentialKeys.push(key);
        }
        log.info("Credentials injected", { count: this.injectedCredentialKeys.length });
    }
    clearCredentials() {
        for (const key of this.injectedCredentialKeys) {
            delete process.env[key];
        }
        if (this.injectedCredentialKeys.length > 0) {
            log.info("Credentials cleared", { count: this.injectedCredentialKeys.length });
        }
        this.injectedCredentialKeys = [];
    }
    async handleStop() {
        this.clearCredentials();
        this.lastCredentials = undefined;
        const { currentRunId, currentStatus } = this.state.get();
        if (!currentRunId) {
            log.warn("No active run to stop");
            return;
        }
        try {
            await this.nemoclaw.rollback(currentRunId);
            this.state.update({ currentStatus: "stopped", currentRunId: null });
            this.sendStatus(currentStatus, "stopped");
            log.info("Sandbox stopped", { runId: currentRunId });
        }
        catch (err) {
            this.state.update({ currentStatus: "error" });
            this.sendStatus(currentStatus, "error");
            log.error("Stop failed", { error: err instanceof Error ? err.message : String(err) });
        }
    }
    async handleRestart(blueprintId) {
        const { currentRunId, currentStatus } = this.state.get();
        // Stop current run if active
        if (currentRunId) {
            try {
                await this.nemoclaw.rollback(currentRunId);
                this.state.update({ currentStatus: "stopped", currentRunId: null });
                this.sendStatus(currentStatus, "stopped");
            }
            catch (err) {
                this.state.update({ currentStatus: "error" });
                this.sendStatus(currentStatus, "error");
                log.error("Restart stop phase failed", {
                    error: err instanceof Error ? err.message : String(err),
                });
                return;
            }
        }
        await this.handleStart(blueprintId);
    }
    async handleUpdateBlueprint(blueprintId) {
        const { currentRunId, currentStatus } = this.state.get();
        this.sendStatus(currentStatus, "updating");
        this.state.update({ currentStatus: "updating" });
        // Rollback current run if active
        if (currentRunId) {
            try {
                await this.nemoclaw.rollback(currentRunId);
                this.state.update({ currentRunId: null });
            }
            catch (err) {
                this.state.update({ currentStatus: "error" });
                this.sendStatus("updating", "error");
                log.error("Update blueprint rollback failed", {
                    error: err instanceof Error ? err.message : String(err),
                });
                return;
            }
        }
        // Apply new blueprint
        await this.handleStart(blueprintId);
    }
    async handleUpdatePolicy(policies) {
        for (const policy of policies) {
            try {
                await this.applyPolicyLocal(policy);
                log.info("Policy applied", { policyId: policy.id, type: policy.type, name: policy.name });
            }
            catch (err) {
                log.error("Policy apply failed", {
                    policyId: policy.id,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
    }
    /** Apply a policy by writing a YAML file for the PII proxy or calling openshell for other types. */
    async applyPolicyLocal(policy) {
        if (policy.type === "pii") {
            // PII policies: write YAML directly — the pii-policy-proxy hot-reloads from this file.
            const policyYaml = { version: 1, pii: policy.spec };
            const yaml = jsonToYaml(policyYaml);
            const path = process.env.PII_POLICY_PATH || "/sandbox/.nemoclaw/pii-policy.yaml";
            const tmpPath = path + ".tmp";
            mkdirSync(dirname(path), { recursive: true });
            await writeFile(tmpPath, yaml, "utf-8");
            await rename(tmpPath, path);
            log.info("PII policy written for hot-reload", { path });
            return;
        }
        // Non-PII policies: call openshell policy set
        const policyYaml = { version: 1 };
        policyYaml[policy.type] = policy.spec;
        const yaml = jsonToYaml(policyYaml);
        const tmpPath = join(tmpdir(), `policy-${randomBytes(6).toString("hex")}.yaml`);
        await writeFile(tmpPath, yaml, "utf-8");
        try {
            await new Promise((resolve, reject) => {
                execFile("openshell", ["policy", "set", policy.name, "--policy", tmpPath], { timeout: 30_000 }, (err, stdout, stderr) => {
                    if (err) {
                        reject(new Error(`openshell policy set failed: ${stderr || err.message}`));
                    }
                    else {
                        if (stdout)
                            log.debug("openshell stdout", { output: stdout.trim() });
                        resolve();
                    }
                });
            });
        }
        finally {
            await unlink(tmpPath).catch(() => { });
        }
    }
    sendStatus(from, to) {
        this.connection.send({
            type: "status_change",
            sandboxId: this.sandboxId,
            from,
            to,
        });
    }
}
/** Minimal JSON-to-YAML serialiser (no external dependency). */
function jsonToYaml(obj, indent = 0) {
    const pad = "  ".repeat(indent);
    if (obj === null || obj === undefined)
        return `${pad}null\n`;
    if (typeof obj === "string")
        return obj.includes("\n") ? `|\n${obj.split("\n").map((l) => `${pad}  ${l}`).join("\n")}\n` : `${JSON.stringify(obj)}\n`;
    if (typeof obj === "number" || typeof obj === "boolean")
        return `${obj}\n`;
    if (Array.isArray(obj)) {
        if (obj.length === 0)
            return "[]\n";
        return obj.map((item) => {
            const val = jsonToYaml(item, indent + 1).trimStart();
            return `${pad}- ${val}`;
        }).join("");
    }
    if (typeof obj === "object") {
        const entries = Object.entries(obj);
        if (entries.length === 0)
            return "{}\n";
        return entries.map(([key, val]) => {
            if (val !== null && typeof val === "object" && !Array.isArray(val) && Object.keys(val).length > 0) {
                return `${pad}${key}:\n${jsonToYaml(val, indent + 1)}`;
            }
            if (Array.isArray(val) && val.length > 0) {
                return `${pad}${key}:\n${jsonToYaml(val, indent + 1)}`;
            }
            return `${pad}${key}: ${jsonToYaml(val, indent)}`;
        }).join("");
    }
    return `${obj}\n`;
}
//# sourceMappingURL=commands.js.map