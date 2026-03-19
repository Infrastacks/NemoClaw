// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import type { PluginLogger, NemoClawConfig } from "../index.js";
import {
  describeOnboardEndpoint,
  describeOnboardProvider,
  loadOnboardConfig,
  saveOnboardConfig,
  type EndpointType,
  type NemoClawOnboardConfig,
} from "../onboard/config.js";
import { promptInput, promptConfirm, promptSelect } from "../onboard/prompt.js";
import { validateApiKey, maskApiKey } from "../onboard/validate.js";
import {
  createDefaultRegistry,
  detectOllama,
  type InferenceProvider,
} from "../providers/index.js";

export interface OnboardOptions {
  apiKey?: string;
  endpoint?: string;
  ncpPartner?: string;
  endpointUrl?: string;
  model?: string;
  logger: PluginLogger;
  pluginConfig: NemoClawConfig;
}

function isExperimentalEnabled(): boolean {
  return process.env.NEMOCLAW_EXPERIMENTAL === "1";
}

function isNonInteractive(opts: OnboardOptions, provider: InferenceProvider | undefined): boolean {
  if (!opts.endpoint || !opts.model || !provider) return false;
  if (provider.requiresApiKey && !opts.apiKey) return false;
  // Providers without a fixed endpoint or nim-local (suggested default, not fixed)
  // need explicit --endpoint-url for non-interactive mode
  const needsExplicitEndpointUrl = !provider.defaultEndpoint || provider.id === "nim-local";
  if (needsExplicitEndpointUrl && !opts.endpointUrl) return false;
  if (opts.endpoint === "ncp" && !opts.ncpPartner) return false;
  return true;
}

function showConfig(config: NemoClawOnboardConfig, logger: PluginLogger): void {
  logger.info(`  Endpoint:    ${describeOnboardEndpoint(config)}`);
  logger.info(`  Provider:    ${describeOnboardProvider(config)}`);
  if (config.ncpPartner) {
    logger.info(`  NCP Partner: ${config.ncpPartner}`);
  }
  logger.info(`  Model:       ${config.model}`);
  logger.info(`  Credential:  $${config.credentialEnv}`);
  logger.info(`  Profile:     ${config.profile}`);
  logger.info(`  Onboarded:   ${config.onboardedAt}`);
}

function execOpenShell(args: string[]): string {
  return execFileSync("openshell", args, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export async function cliOnboard(opts: OnboardOptions): Promise<void> {
  const { logger } = opts;
  const registry = createDefaultRegistry();

  // Resolve provider early for nonInteractive check
  const resolvedProvider = opts.endpoint ? registry.get(opts.endpoint) : undefined;
  const nonInteractive = isNonInteractive(opts, resolvedProvider);

  logger.info("NemoClaw Onboarding");
  logger.info("-------------------");

  // Step 0: Check existing config
  const existing = loadOnboardConfig();
  if (existing) {
    logger.info("");
    logger.info("Existing configuration found:");
    showConfig(existing, logger);
    logger.info("");

    if (!nonInteractive) {
      const reconfigure = await promptConfirm("Reconfigure?", false);
      if (!reconfigure) {
        logger.info("Keeping existing configuration.");
        return;
      }
    }
  }

  // Step 1: Endpoint Selection
  let endpointType: EndpointType;
  if (opts.endpoint) {
    if (!registry.get(opts.endpoint)) {
      const allTypes = registry.list().flatMap((p) => [...p.endpointTypes]);
      logger.error(
        `Invalid endpoint type: ${opts.endpoint}. Must be one of: ${allTypes.join(", ")}`,
      );
      return;
    }
    const ep = registry.resolve(opts.endpoint);
    if (ep.isExperimental) {
      logger.warn(
        `Note: '${opts.endpoint}' is experimental and may not work reliably.`,
      );
    }
    endpointType = opts.endpoint as EndpointType;
  } else {
    const ollama = detectOllama();
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
    endpointType = (await promptSelect("Select your inference endpoint:", options)) as EndpointType;
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
  const ncpPartner = (extraConfig.ncpPartner as string) ?? null;
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
    } else {
      const envKey = process.env[credentialEnv];
      if (envKey) {
        logger.info(`Detected ${credentialEnv} in environment (${maskApiKey(envKey)})`);
        const useEnv = nonInteractive ? true : await promptConfirm("Use this key?");
        apiKey = useEnv ? envKey : await promptInput("Enter your API key");
      } else {
        if (credentialEnv === "NVIDIA_API_KEY") {
          logger.info("Get an API key from: https://build.nvidia.com/settings/api-keys");
        }
        apiKey = await promptInput("Enter your API key");
      }
    }
  } else {
    logger.info(
      `No API key required for ${endpointType}. Using local credential value '${apiKey}'.`,
    );
  }

  if (!apiKey) {
    logger.error("No API key provided. Aborting.");
    return;
  }

  // Step 4: Validate API Key
  // For local providers, validation is best-effort since the service may not be running yet.
  logger.info("");
  logger.info(`Validating ${provider.requiresApiKey ? "credential" : "endpoint"} against ${endpointUrl}...`);
  const validation = await validateApiKey(apiKey, endpointUrl);

  if (!validation.valid) {
    if (provider.isLocal) {
      logger.warn(
        `Could not reach ${endpointUrl} (${validation.error ?? "unknown error"}). Continuing anyway — the service may not be running yet.`,
      );
    } else {
      logger.error(`API key validation failed: ${validation.error ?? "unknown error"}`);
      logger.info("Check your key at https://build.nvidia.com/settings/api-keys");
      return;
    }
  } else {
    logger.info(
      `${provider.requiresApiKey ? "Credential" : "Endpoint"} valid. ${String(validation.models.length)} model(s) available.`,
    );
  }

  // Step 5: Model Selection
  let model: string;
  if (opts.model) {
    model = opts.model;
  } else {
    // Ollama discovers models via `ollama list`; others use validation response
    const discoveredModels =
      provider.id === "ollama"
        ? await provider.discoverModels(apiKey, endpointUrl)
        : validation.models;

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

    model = await promptSelect(
      "Select your primary model:",
      modelOptions.map((m) => ({ label: m.label, value: m.id })),
      defaultIndex,
    );
  }

  // Step 6: Resolve profile
  const profile = provider.profileName;
  const providerName = provider.providerName;
  const summaryConfig: NemoClawOnboardConfig = {
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
  summaryConfig.providerLabel = describeOnboardProvider(summaryConfig);

  // Step 7: Confirmation
  logger.info("");
  logger.info("Configuration summary:");
  logger.info(`  Endpoint:    ${describeOnboardEndpoint(summaryConfig)}`);
  logger.info(`  Provider:    ${summaryConfig.providerLabel}`);
  if (ncpPartner) {
    logger.info(`  NCP Partner: ${ncpPartner}`);
  }
  logger.info(`  Model:       ${model}`);
  logger.info(
    `  API Key:     ${provider.requiresApiKey ? maskApiKey(apiKey) : "not required (local provider)"}`,
  );
  logger.info(`  Credential:  $${credentialEnv}`);
  logger.info(`  Profile:     ${profile}`);
  logger.info(`  Provider:    ${providerName}`);
  logger.info("");

  if (!nonInteractive) {
    const proceed = await promptConfirm("Apply this configuration?");
    if (!proceed) {
      logger.info("Onboarding cancelled.");
      return;
    }
  }

  // Step 8: Apply
  logger.info("");
  logger.info("Applying configuration...");

  // 8a: Create/update provider
  try {
    execOpenShell([
      "provider",
      "create",
      "--name",
      providerName,
      "--type",
      "openai",
      "--credential",
      `${credentialEnv}=${apiKey}`,
      "--config",
      `OPENAI_BASE_URL=${endpointUrl}`,
    ]);
    logger.info(`Created provider: ${providerName}`);
  } catch (err) {
    const stderr =
      err instanceof Error && "stderr" in err ? String((err as { stderr: unknown }).stderr) : "";
    if (stderr.includes("AlreadyExists") || stderr.includes("already exists")) {
      try {
        execOpenShell([
          "provider",
          "update",
          providerName,
          "--credential",
          `${credentialEnv}=${apiKey}`,
          "--config",
          `OPENAI_BASE_URL=${endpointUrl}`,
        ]);
        logger.info(`Updated provider: ${providerName}`);
      } catch (updateErr) {
        const updateStderr =
          updateErr instanceof Error && "stderr" in updateErr
            ? String((updateErr as { stderr: unknown }).stderr)
            : "";
        logger.error(`Failed to update provider: ${updateStderr || String(updateErr)}`);
        return;
      }
    } else {
      logger.error(`Failed to create provider: ${stderr || String(err)}`);
      return;
    }
  }

  // 8b: Set inference route
  try {
    execOpenShell(["inference", "set", "--provider", providerName, "--model", model]);
    logger.info(`Inference route set: ${providerName} -> ${model}`);
  } catch (err) {
    const stderr =
      err instanceof Error && "stderr" in err ? String((err as { stderr: unknown }).stderr) : "";
    logger.error(`Failed to set inference route: ${stderr || String(err)}`);
    return;
  }

  // 8c: Save config
  saveOnboardConfig({
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
  logger.info(`  Endpoint:   ${describeOnboardEndpoint(summaryConfig)}`);
  logger.info(`  Provider:   ${summaryConfig.providerLabel}`);
  logger.info(`  Model:      ${model}`);
  logger.info(`  Credential: $${credentialEnv}`);
  logger.info("");
  logger.info("Next steps:");
  logger.info("  openclaw nemoclaw launch     # Bootstrap sandbox");
  logger.info("  openclaw nemoclaw status     # Check configuration");
}
