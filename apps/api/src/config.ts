const isProd = process.env.NODE_ENV === "production";

/** Shared dev fallback for the Next BFF <-> API token. */
export const DEV_INTERNAL_TOKEN = "dev-internal-token";

/**
 * Required in production, but falls back to a dev value locally so
 * `pnpm dev` works with zero env setup.
 */
function requireInProd(name: string, devValue: string): string {
  const value = process.env[name];
  if (value) return value;
  if (isProd) throw new Error(`${name} is not set`);
  return devValue;
}

export interface Config {
  port: number;
  clusterApiUrl: string;
  ipfsApiUrl: string;
  internalToken: string;
  accountingIntervalMs: number | null;
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.PORT ?? 8080),
    clusterApiUrl: process.env.CLUSTER_API_URL ?? "http://localhost:9094",
    ipfsApiUrl: process.env.IPFS_API_URL ?? "http://localhost:5001",
    internalToken: requireInProd("INTERNAL_TOKEN", DEV_INTERNAL_TOKEN),
    accountingIntervalMs: process.env.ACCOUNTING_INTERVAL_MS
      ? Number(process.env.ACCOUNTING_INTERVAL_MS)
      : null,
  };
}
