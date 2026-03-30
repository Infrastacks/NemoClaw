"use strict";
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.cliOnboard = cliOnboard;
const node_child_process_1 = require("node:child_process");
const config_js_1 = require("../onboard/config.js");
const prompt_js_1 = require("../onboard/prompt.js");
const validate_js_1 = require("../onboard/validate.js");
const index_js_1 = require("../providers/index.js");
const index_js_2 = require("../telemetry/index.js");
const inference_js_1 = require("../telemetry/inference.js");
function isExperimentalEnabled() {
    return process.env.NEMOCLAW_EXPERIMENTAL === "1";
}
function isNonInteractive(opts, provider) {
    if (!opts.endpoint || !opts.model || !provider)
        return false;
    if (provider.requiresApiKey && !opts.apiKey)
        return false;
    // Providers without a fixed endpoint or nim-local (suggested default, not fixed)
    // need explicit --endpoint-url for non-interactive mode
    const needsExplicitEndpointUrl = !provider.defaultEndpoint || provider.id === "nim-local";
    if (needsExplicitEndpointUrl && !opts.endpointUrl)
        return false;
    if (opts.endpoint === "ncp" && !opts.ncpPartner)
        return false;
    return true;
}
function showConfig(config, logger) {
    logger.info(`  Endpoint:    ${(0, config_js_1.describeOnboardEndpoint)(config)}`);
    logger.info(`  Provider:    ${(0, config_js_1.describeOnboardProvider)(config)}`);
    if (config.ncpPartner) {
        logger.info(`  NCP Partner: ${config.ncpPartner}`);
    }
    logger.info(`  Model:       ${config.model}`);
    logger.info(`  Credential:  $${config.credentialEnv}`);
    logger.info(`  Profile:     ${config.profile}`);
    logger.info(`  Onboarded:   ${config.onboardedAt}`);
}
function execOpenShell(args) {
    return (0, node_child_process_1.execFileSync)("openshell", args, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
    });
}
function appendProviderArgs(args, config) {
    const nextArgs = [...args];
    for (const [name, value] of Object.entries(config.credentials ?? {})) {
        nextArgs.push("--credential", `${name}=${value}`);
    }
    for (const [name, value] of Object.entries(config.credentialEnvRefs ?? {})) {
        nextArgs.push("--credential-env", `${name}=${value}`);
    }
    for (const [name, value] of Object.entries(config.config ?? {})) {
        nextArgs.push("--config", `${name}=${value}`);
    }
    return nextArgs;
}
function redactSensitiveText(input, secrets) {
    return secrets.filter(Boolean).reduce((current, secret) => current.split(secret).join("[REDACTED]"), input);
}
async function cliOnboard(opts) {
    const { logger } = opts;
    const emitter = new index_js_2.TelemetryEmitter({ sinks: [new index_js_2.FileSink()] });
    const registry = (0, index_js_1.createDefaultRegistry)();
    // Resolve provider early for nonInteractive check
    const resolvedProvider = opts.endpoint ? registry.get(opts.endpoint) : undefined;
    const nonInteractive = isNonInteractive(opts, resolvedProvider);
    logger.info("NemoClaw Onboarding");
    logger.info("-------------------");
    // Step 0: Check existing config
    const existing = (0, config_js_1.loadOnboardConfig)();
    if (existing) {
        logger.info("");
        logger.info("Existing configuration found:");
        showConfig(existing, logger);
        logger.info("");
        if (!nonInteractive) {
            const reconfigure = await (0, prompt_js_1.promptConfirm)("Reconfigure?", false);
            if (!reconfigure) {
                logger.info("Keeping existing configuration.");
                return;
            }
        }
    }
    // Step 1: Endpoint Selection
    let endpointType;
    if (opts.endpoint) {
        if (!registry.get(opts.endpoint)) {
            const allTypes = registry.list().flatMap((p) => [...p.endpointTypes]);
            logger.error(`Invalid endpoint type: ${opts.endpoint}. Must be one of: ${allTypes.join(", ")}`);
            return;
        }
        const ep = registry.resolve(opts.endpoint);
        if (ep.isExperimental) {
            logger.warn(`Note: '${opts.endpoint}' is experimental and may not work reliably.`);
        }
        endpointType = opts.endpoint;
    }
    else {
        const ollama = (0, index_js_1.detectOllama)();
        if (ollama.running) {
            logger.info("Detected local inference option: Ollama.");
            logger.info("Select it explicitly if you want to use it.");
        }
        const wizardCtx = { ollamaInstalled: ollama.installed, ollamaRunning: ollama.running };
        const providers = registry.list().filter((p) => !p.isExperimental || isExperimentalEnabled());
        const options = providers.map((p) => ({
            label: p.label,
            value: p.id,
            hint: p.wizardHint(wizardCtx),
        }));
        endpointType = (await (0, prompt_js_1.promptSelect)("Select your inference endpoint:", options));
    }
    const provider = registry.resolve(endpointType);
    // Step 2: Endpoint URL + extra config
    const resolutionCtx = {
        endpointType,
        endpointUrl: opts.endpointUrl,
        ncpPartner: opts.ncpPartner,
        nonInteractive,
    };
    // Resolve extra config first (NCP partner prompt comes before endpoint URL prompt)
    const extraConfig = await provider.resolveExtraConfig(resolutionCtx);
    const ncpPartner = extraConfig.ncpPartner ?? null;
    const endpointUrl = await provider.resolveEndpointUrl(resolutionCtx);
    if (!endpointUrl) {
        logger.error("No endpoint URL provided. Aborting.");
        return;
    }
    const credentialEnv = provider.credentialEnvVar;
    // Step 3: Credential
    let apiKey = provider.defaultCredential;
    if (provider.requiresApiKey) {
        if (opts.apiKey) {
            apiKey = opts.apiKey;
        }
        else {
            const envKey = process.env[credentialEnv];
            if (envKey) {
                logger.info(`Detected ${credentialEnv} in environment (${(0, validate_js_1.maskApiKey)(envKey)})`);
                const useEnv = nonInteractive ? true : await (0, prompt_js_1.promptConfirm)("Use this key?");
                apiKey = useEnv ? envKey : await (0, prompt_js_1.promptInput)("Enter your API key");
            }
            else {
                if (credentialEnv === "NVIDIA_API_KEY") {
                    logger.info("Get an API key from: https://build.nvidia.com/settings/api-keys");
                }
                else if (credentialEnv === "AZURE_OPENAI_API_KEY") {
                    logger.info("Get an API key from the Azure Portal under your OpenAI resource → Keys and Endpoint");
                }
                apiKey = await (0, prompt_js_1.promptInput)("Enter your API key");
            }
        }
    }
    else {
        logger.info(`No API key required for ${endpointType}. Using local credential value '${apiKey}'.`);
    }
    if (!apiKey) {
        logger.error("No API key provided. Aborting.");
        return;
    }
    // Step 4: Validate API Key
    // For local providers, validation is best-effort since the service may not be running yet.
    logger.info("");
    logger.info(`Validating ${provider.requiresApiKey ? "credential" : "endpoint"} against ${endpointUrl}...`);
    const telemetryCtx = { provider: provider.id, model: "", endpoint: endpointUrl, operation: "" };
    const validationValid = await (0, inference_js_1.withInferenceTelemetry)(emitter, { ...telemetryCtx, operation: "validateCredentials" }, () => provider.validateCredentials(apiKey, endpointUrl));
    const validationModels = validationValid || provider.id === "ollama"
        ? await (0, inference_js_1.withInferenceTelemetry)(emitter, { ...telemetryCtx, operation: "discoverModels" }, () => provider.discoverModels(apiKey, endpointUrl))
        : [];
    if (!validationValid) {
        if (provider.isLocal) {
            logger.warn(`Could not validate ${endpointUrl}. Continuing anyway — the service may not be running yet.`);
        }
        else {
            logger.error("API key validation failed.");
            if (credentialEnv === "AZURE_OPENAI_API_KEY") {
                logger.info("Check your key and endpoint in the Azure Portal under your OpenAI resource → Keys and Endpoint");
            }
            else {
                logger.info("Check your key at https://build.nvidia.com/settings/api-keys");
            }
            return;
        }
    }
    else {
        logger.info(`${provider.requiresApiKey ? "Credential" : "Endpoint"} valid. ${String(validationModels.length)} model(s) available.`);
    }
    // Step 5: Model Selection
    let model;
    if (opts.model) {
        model = opts.model;
    }
    else {
        const discoveredModels = validationModels;
        let modelOptions = provider.buildModelOptions(discoveredModels);
        if (modelOptions.length === 0) {
            // Fallback to NVIDIA curated models when no discovered models available
            const fallback = registry.resolve("build");
            modelOptions = fallback.curatedModels.map((m) => ({
                id: m.id,
                label: `${m.label} (${m.id})`,
            }));
        }
        const defaultId = provider.defaultModelId(discoveredModels);
        const defaultIndex = Math.max(0, modelOptions.findIndex((o) => o.id === defaultId));
        model = await (0, prompt_js_1.promptSelect)("Select your primary model:", modelOptions.map((m) => ({ label: m.label, value: m.id })), defaultIndex);
    }
    // Step 6: Resolve profile
    const profile = provider.profileName;
    const providerName = provider.providerName;
    const summaryConfig = {
        endpointType,
        endpointUrl,
        ncpPartner,
        model,
        profile,
        credentialEnv,
        provider: providerName,
        providerLabel: undefined,
        onboardedAt: "",
    };
    summaryConfig.providerLabel = (0, config_js_1.describeOnboardProvider)(summaryConfig);
    // Step 7: Confirmation
    logger.info("");
    logger.info("Configuration summary:");
    logger.info(`  Endpoint:    ${(0, config_js_1.describeOnboardEndpoint)(summaryConfig)}`);
    logger.info(`  Provider:    ${summaryConfig.providerLabel}`);
    if (ncpPartner) {
        logger.info(`  NCP Partner: ${ncpPartner}`);
    }
    logger.info(`  Model:       ${model}`);
    logger.info(`  API Key:     ${provider.requiresApiKey ? (0, validate_js_1.maskApiKey)(apiKey) : "not required (local provider)"}`);
    logger.info(`  Credential:  $${credentialEnv}`);
    logger.info(`  Profile:     ${profile}`);
    logger.info(`  Provider:    ${providerName}`);
    logger.info("");
    if (!nonInteractive) {
        const proceed = await (0, prompt_js_1.promptConfirm)("Apply this configuration?");
        if (!proceed) {
            logger.info("Onboarding cancelled.");
            return;
        }
    }
    // Step 8: Apply
    logger.info("");
    logger.info("Applying configuration...");
    // 8a: Create/update provider
    const providerConfig = provider.toOpenShellProviderConfig(apiKey, endpointUrl);
    const redact = (message) => redactSensitiveText(message, provider.requiresApiKey ? [apiKey] : []);
    try {
        execOpenShell(appendProviderArgs([
            "provider",
            "create",
            "--name",
            providerName,
            "--type",
            providerConfig.type,
        ], providerConfig));
        logger.info(`Created provider: ${providerName}`);
    }
    catch (err) {
        const stderr = err instanceof Error && "stderr" in err ? String(err.stderr) : "";
        if (stderr.includes("AlreadyExists") || stderr.includes("already exists")) {
            try {
                execOpenShell(appendProviderArgs([
                    "provider",
                    "update",
                    providerName,
                ], providerConfig));
                logger.info(`Updated provider: ${providerName}`);
            }
            catch (updateErr) {
                const updateStderr = updateErr instanceof Error && "stderr" in updateErr
                    ? String(updateErr.stderr)
                    : "";
                logger.error(`Failed to update provider: ${redact(updateStderr || String(updateErr))}`);
                return;
            }
        }
        else {
            logger.error(`Failed to create provider: ${redact(stderr || String(err))}`);
            return;
        }
    }
    // 8b: Set inference route
    try {
        execOpenShell(["inference", "set", "--provider", providerName, "--model", model]);
        logger.info(`Inference route set: ${providerName} -> ${model}`);
    }
    catch (err) {
        const stderr = err instanceof Error && "stderr" in err ? String(err.stderr) : "";
        logger.error(`Failed to set inference route: ${redact(stderr || String(err))}`);
        return;
    }
    emitter.emit(index_js_2.INFERENCE_CONFIGURED, {
        source: "inference",
        provider: providerName,
        model,
        endpoint: endpointUrl,
    });
    // 8c: Save config
    (0, config_js_1.saveOnboardConfig)({
        endpointType,
        endpointUrl,
        ncpPartner,
        model,
        profile,
        credentialEnv,
        provider: providerName,
        providerLabel: summaryConfig.providerLabel,
        onboardedAt: new Date().toISOString(),
    });
    // Step 9: Success
    logger.info("");
    logger.info("Onboarding complete!");
    logger.info("");
    logger.info(`  Endpoint:   ${(0, config_js_1.describeOnboardEndpoint)(summaryConfig)}`);
    logger.info(`  Provider:   ${summaryConfig.providerLabel}`);
    logger.info(`  Model:      ${model}`);
    logger.info(`  Credential: $${credentialEnv}`);
    logger.info("");
    logger.info("Next steps:");
    logger.info("  openclaw nemoclaw launch     # Bootstrap sandbox");
    logger.info("  openclaw nemoclaw status     # Check configuration");
}
//# sourceMappingURL=onboard.js.map