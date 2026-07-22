import { mkdir, readFile, writeFile } from "node:fs/promises";
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
 * Credentials for `econome publish`, kept in a separate 0600 file rather than
 * in config.json: the follower config is written wholesale by `join`, which
 * would clobber a stored key.
 */
export interface PublishCredentials {
  apiKey?: string;
  apiUrl?: string;
  gatewayUrl?: string;
}

export const PUBLISH_FILE = "publish.json";

export async function readPublishCredentials(
  dir: string,
): Promise<PublishCredentials | null> {
  try {
    const raw = await readFile(join(dir, PUBLISH_FILE), "utf8");
    return JSON.parse(raw) as PublishCredentials;
  } catch {
    return null;
  }
}

/** Written 0600: it holds a credential. */
export async function writePublishCredentials(
  dir: string,
  creds: PublishCredentials,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, PUBLISH_FILE);
  await writeFile(path, `${JSON.stringify(creds, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return path;
}
