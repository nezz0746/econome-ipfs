import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FollowerConfig } from "./config";

export interface ProjectConfig {
  server: string;
  token: string;
  clusterName: string;
}

/** The follower project directory (`~/.econome`, overridable via ECONOME_DIR). */
export function projectDir(): string {
  return process.env.ECONOME_DIR ?? join(homedir(), ".econome");
}

/** Write the compose, kubo init, and config files into `dir` (created if needed). */
export async function writeProject(
  dir: string,
  cfg: FollowerConfig,
  meta: ProjectConfig,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "docker-compose.yml"), cfg.compose, "utf8");
  await writeFile(join(dir, "kubo-init.sh"), cfg.kuboInit, "utf8");
  await writeFile(
    join(dir, "config.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
    "utf8",
  );
}

/** Read the stored project config, or null if the project hasn't been set up. */
export async function readProjectConfig(
  dir: string,
): Promise<ProjectConfig | null> {
  try {
    const raw = await readFile(join(dir, "config.json"), "utf8");
    return JSON.parse(raw) as ProjectConfig;
  } catch {
    return null;
  }
}

/**
 * CLI credentials, kept in their own 0600 file rather than in config.json:
 * the follower config is written wholesale by `join`, which would clobber a
 * stored key. Named generically because anything beyond publish that needs
 * the machine API will use the same credential.
 */
export interface Credentials {
  apiKey?: string;
  apiUrl?: string;
  gatewayUrl?: string;
}

export const CREDENTIALS_FILE = "creds.json";

export async function readCredentials(
  dir: string,
): Promise<Credentials | null> {
  try {
    const raw = await readFile(join(dir, CREDENTIALS_FILE), "utf8");
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

/** Written 0600: it holds a credential. */
export async function writeCredentials(
  dir: string,
  creds: Credentials,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, CREDENTIALS_FILE);
  await writeFile(path, `${JSON.stringify(creds, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return path;
}

/** Remove stored credentials. Returns false when there were none. */
export async function clearCredentials(dir: string): Promise<boolean> {
  try {
    await rm(join(dir, CREDENTIALS_FILE));
    return true;
  } catch {
    return false;
  }
}
