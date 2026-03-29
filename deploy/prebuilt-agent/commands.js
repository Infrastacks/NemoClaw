import { execFile } from "node:child_process";
import { writeFile, readFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
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
        await this.handleStart(blueprintId, credentials);
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
    /**
     * Apply a policy update to the running sandbox.
     *
     * - PII → merge into sandbox-policy.yaml pii section (hot-reloaded by file watcher)
     * - Supply chain → write separate file (OpenShell re-reads per tunnel, no restart)
     * - Network/other → merge into sandbox-policy.yaml network_policies (hot-reloaded by file watcher)
     */
    async applyPolicyLocal(policy) {
        if (policy.type === "supply_chain") {
            // Supply chain: write snake_case YAML. OpenShell re-reads this file per tunnel
            // (proxy.rs:561-589), so no restart is needed for supply chain policy changes.
            const spec = policy.spec;
            const vt = (spec.vulnerabilityThresholds ?? {});
            const lp = (spec.licensePolicy ?? {});
            const scYaml = {
                version: 1,
                supply_chain: {
                    enforcement: spec.enforcement ?? "audit",
                    vulnerability_thresholds: {
                        max_critical: vt.maxCritical ?? 0,
                        max_high: vt.maxHigh ?? 5,
                        block_unfixed_critical: vt.blockUnfixedCritical ?? false,
                    },
                    license_policy: {
                        allowed: lp.allowed ?? [],
                        denied: lp.denied ?? [],
                    },
                    denylist: Array.isArray(spec.denylist) ? spec.denylist : [],
                    version_pinning: Array.isArray(spec.versionPinning) ? spec.versionPinning : [],
                    osv_cache_ttl_hours: spec.osvCacheTtlHours ?? 4,
                },
            };
            const yaml = jsonToYaml(scYaml);
            const scPath = process.env.SUPPLY_CHAIN_POLICY_PATH || "/sandbox/.nemoclaw/supply-chain-policy.yaml";
            const tmpSc = scPath + ".tmp";
            mkdirSync(dirname(scPath), { recursive: true });
            await writeFile(tmpSc, yaml, "utf-8");
            await rename(tmpSc, scPath);
            log.info("Supply chain policy written", { path: scPath });
            return;
        }
        if (policy.type === "pii") {
            // PII: merge into the sandbox policy's pii section. OpenShell's file watcher
            // detects the mtime change and hot-reloads the OPA engine within ~2 seconds.
            await this.mergePolicySection("pii", policy.spec);
            log.info("PII policy merged (hot-reload via file watcher)");
            return;
        }
        // Network/other: merge into sandbox-policy.yaml network_policies section.
        // OpenShell's file watcher hot-reloads the OPA engine on mtime change.
        await this.mergeNetworkPolicy(policy.name, policy.spec);
        log.info("Network policy merged (hot-reload via file watcher)", { name: policy.name });
    }
    /**
     * Merge a top-level section (e.g. "pii") into the sandbox policy.
     * Reads the JSON sidecar, updates the section, writes both JSON + YAML atomically.
     */
    async mergePolicySection(section, spec) {
        const { jsonPath, yamlPath } = this.policyPaths();
        const policy = await this.readPolicyJson(jsonPath);
        policy[section] = spec;
        await this.writePolicyFiles(policy, jsonPath, yamlPath);
    }
    /**
     * Merge a named network policy (or policy with network_policies key) into the sandbox policy.
     */
    async mergeNetworkPolicy(name, spec) {
        const { jsonPath, yamlPath } = this.policyPaths();
        const policy = await this.readPolicyJson(jsonPath);
        const np = (policy.network_policies ?? {});
        const s = spec;
        if (s && "network_policies" in s) {
            Object.assign(np, s.network_policies);
        }
        else if (s && "endpoints" in s) {
            np[name] = s;
        }
        policy.network_policies = np;
        await this.writePolicyFiles(policy, jsonPath, yamlPath);
    }
    policyPaths() {
        return {
            jsonPath: "/sandbox/.nemoclaw/sandbox-policy.json",
            yamlPath: "/sandbox/.nemoclaw/sandbox-policy.yaml",
        };
    }
    async readPolicyJson(jsonPath) {
        const raw = await readFile(jsonPath, "utf-8");
        return JSON.parse(raw);
    }
    async writePolicyFiles(policy, jsonPath, yamlPath) {
        // Write JSON sidecar (atomic)
        await writeFile(jsonPath + ".tmp", JSON.stringify(policy), "utf-8");
        await rename(jsonPath + ".tmp", jsonPath);
        // Write YAML for OpenShell (atomic)
        await writeFile(yamlPath + ".tmp", jsonToYaml(policy), "utf-8");
        await rename(yamlPath + ".tmp", yamlPath);
    }
    /** Restart the OpenShell CONNECT proxy to pick up policy changes. */
    restartOpenShell() {
        return new Promise((resolve, reject) => {
            execFile("/usr/local/bin/restart-openshell.sh", [], { timeout: 30_000 }, (err, _stdout, stderr) => {
                if (err)
                    reject(new Error(`OpenShell restart failed: ${stderr || err.message}`));
                else
                    resolve();
            });
        });
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