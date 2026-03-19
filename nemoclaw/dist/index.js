"use strict";
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPluginConfig = getPluginConfig;
exports.default = register;
const cli_js_1 = require("./cli.js");
const slash_js_1 = require("./commands/slash.js");
const config_js_1 = require("./onboard/config.js");
const index_js_1 = require("./providers/index.js");
const DEFAULT_PLUGIN_CONFIG = {
    blueprintVersion: "latest",
    blueprintRegistry: "ghcr.io/nvidia/nemoclaw-blueprint",
    sandboxName: "openclaw",
    inferenceProvider: "nvidia",
};
function getPluginConfig(api) {
    const raw = api.pluginConfig ?? {};
    return {
        blueprintVersion: typeof raw["blueprintVersion"] === "string"
            ? raw["blueprintVersion"]
            : DEFAULT_PLUGIN_CONFIG.blueprintVersion,
        blueprintRegistry: typeof raw["blueprintRegistry"] === "string"
            ? raw["blueprintRegistry"]
            : DEFAULT_PLUGIN_CONFIG.blueprintRegistry,
        sandboxName: typeof raw["sandboxName"] === "string"
            ? raw["sandboxName"]
            : DEFAULT_PLUGIN_CONFIG.sandboxName,
        inferenceProvider: typeof raw["inferenceProvider"] === "string"
            ? raw["inferenceProvider"]
            : DEFAULT_PLUGIN_CONFIG.inferenceProvider,
    };
}
// ---------------------------------------------------------------------------
// Plugin entry point
// ---------------------------------------------------------------------------
function register(api) {
    // 1. Register /nemoclaw slash command (chat interface)
    api.registerCommand({
        name: "nemoclaw",
        description: "NemoClaw sandbox management (status, eject).",
        acceptsArgs: true,
        handler: (ctx) => (0, slash_js_1.handleSlashCommand)(ctx, api),
    });
    // 2. Register `openclaw nemoclaw` CLI subcommands (commander.js)
    api.registerCli((cliCtx) => {
        (0, cli_js_1.registerCliCommands)(cliCtx, api);
    }, { commands: ["nemoclaw"] });
    // 3. Register inference provider — use onboard config if available
    const registry = (0, index_js_1.createDefaultRegistry)();
    const onboardCfg = (0, config_js_1.loadOnboardConfig)();
    const provider = registry.resolve(onboardCfg?.endpointType ?? "build");
    const credentialEnv = onboardCfg?.credentialEnv ?? provider.credentialEnvVar;
    api.registerProvider(provider.toProviderPlugin(onboardCfg?.model ?? null, credentialEnv));
    const bannerEndpoint = onboardCfg ? (0, config_js_1.describeOnboardEndpoint)(onboardCfg) : "build.nvidia.com";
    const bannerProvider = onboardCfg ? (0, config_js_1.describeOnboardProvider)(onboardCfg) : "NVIDIA Cloud API";
    const bannerModel = onboardCfg?.model ?? "nvidia/nemotron-3-super-120b-a12b";
    api.logger.info("");
    api.logger.info("  ┌─────────────────────────────────────────────────────┐");
    api.logger.info("  │  NemoClaw registered                                │");
    api.logger.info("  │                                                     │");
    api.logger.info(`  │  Endpoint:  ${bannerEndpoint.padEnd(40)}│`);
    api.logger.info(`  │  Provider:  ${bannerProvider.padEnd(40)}│`);
    api.logger.info(`  │  Model:     ${bannerModel.padEnd(40)}│`);
    api.logger.info("  │  Commands:  openclaw nemoclaw <command>             │");
    api.logger.info("  └─────────────────────────────────────────────────────┘");
    api.logger.info("");
}
//# sourceMappingURL=index.js.map