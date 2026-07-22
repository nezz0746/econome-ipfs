export interface PublishConfig {
  apiUrl: string;
  apiKey: string;
  gatewayUrl: string;
}

export const DEFAULT_API_URL = "https://ipfs-api.econome.studio";
export const DEFAULT_GATEWAY_URL = "https://ipfs-gateway.econome.studio";

/** Strip trailing slashes so callers can join paths without doubling them. */
export function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export interface ResolveInput {
  env: Record<string, string | undefined>;
  /** Values read from ~/.econome/config.json, if the file exists. */
  stored?: { apiUrl?: string; apiKey?: string; gatewayUrl?: string } | null;
  /** Explicit command-line overrides. */
  flags?: { apiUrl?: string; gatewayUrl?: string };
}

/**
 * Resolve where we publish and with which credential.
 *
 * Precedence is flags, then environment, then the stored project config, then
 * the public defaults. Environment beats the stored file on purpose: CI and
 * one-off runs against another cluster must not depend on what happens to be
 * in the developer's home directory.
 *
 * The API key is deliberately NOT accepted as a flag: it would end up in shell
 * history and in CI logs.
 */
export function resolvePublishConfig(input: ResolveInput): PublishConfig {
  const { env, stored, flags } = input;

  const apiUrl = normalizeOrigin(
    flags?.apiUrl ?? env.ECONOME_API_URL ?? stored?.apiUrl ?? DEFAULT_API_URL,
  );
  const gatewayUrl = normalizeOrigin(
    flags?.gatewayUrl ??
      env.ECONOME_GATEWAY_URL ??
      stored?.gatewayUrl ??
      DEFAULT_GATEWAY_URL,
  );
  const apiKey = (env.ECONOME_API_KEY ?? stored?.apiKey ?? "").trim();

  return { apiUrl, apiKey, gatewayUrl };
}

/** Human-readable reason the config cannot be used, or null when it is usable. */
export function explainMissing(config: PublishConfig): string | null {
  if (!config.apiKey) {
    return [
      "No API key found.",
      "",
      "Set one for this shell:",
      "  export ECONOME_API_KEY=…",
      "",
      "or store it once:",
      "  econome publish --save-key",
    ].join("\n");
  }
  if (!/^https?:\/\//.test(config.apiUrl)) {
    return `Invalid API URL: ${config.apiUrl}`;
  }
  return null;
}
