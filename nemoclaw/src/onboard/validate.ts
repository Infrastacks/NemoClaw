// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

export interface ValidationResult {
  valid: boolean;
  models: string[];
  error: string | null;
}

export interface ValidateOptions {
  modelsUrl?: string;
  headers?: Record<string, string>;
}

export function azureValidateOptions(apiKey: string, endpointUrl: string): ValidateOptions {
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2024-12-01-preview";
  return {
    modelsUrl: `${endpointUrl.replace(/\/+$/, "")}/openai/models?api-version=${apiVersion}`,
    headers: { "api-key": apiKey },
  };
}

export async function validateApiKey(
  apiKey: string,
  endpointUrl: string,
  options?: ValidateOptions,
): Promise<ValidationResult> {
  const url = options?.modelsUrl ?? `${endpointUrl.replace(/\/+$/, "")}/models`;
  const headers = options?.headers ?? { Authorization: `Bearer ${apiKey}` };
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 10_000);

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        valid: false,
        models: [],
        error: `HTTP ${String(response.status)}: ${body.slice(0, 200)}`,
      };
    }

    const json = (await response.json()) as { data?: { id: string }[] };
    const models = (json.data ?? []).map((m) => m.id);
    return { valid: true, models, error: null };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? "Request timed out (10s)"
          : err.message
        : String(err);
    return { valid: false, models: [], error: message };
  } finally {
    clearTimeout(timeout);
  }
}

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return "****";
  const last4 = apiKey.slice(-4);
  if (apiKey.startsWith("nvapi-")) {
    return `nvapi-****${last4}`;
  }
  return `****${last4}`;
}
