import * as p from "@clack/prompts";
import { FoldersApi } from "../lib/folders-api.js";
import {
  clearCredentials,
  projectDir,
  readCredentials,
  writeCredentials,
} from "../lib/project.js";
import { resolvePublishConfig } from "../lib/publish-config.js";

/** Never print a stored key, only whether one exists and how it ends. */
function fingerprint(key: string): string {
  return key.length <= 6 ? "…" : `…${key.slice(-4)}`;
}

export interface AuthOptions {
  apiUrl?: string;
  verify?: boolean;
}

export async function login(opts: AuthOptions): Promise<void> {
  p.intro("Econome auth");

  const stored = await readCredentials(projectDir());
  const answer = await p.password({
    message: "API key",
    validate: (v) => (v && v.trim() ? undefined : "A key is required."),
  });
  if (p.isCancel(answer)) {
    p.cancel("Cancelled.");
    return;
  }
  const apiKey = answer.trim();

  const config = resolvePublishConfig({
    env: process.env,
    stored: { ...(stored ?? {}), apiKey },
    flags: { apiUrl: opts.apiUrl },
  });

  // Verify before storing: a mistyped key that only fails on the first publish
  // is a worse experience than one rejected here.
  if (opts.verify !== false) {
    const spinner = p.spinner();
    spinner.start(`Checking against ${config.apiUrl}`);
    try {
      await new FoldersApi(config.apiUrl, apiKey).list();
      spinner.stop("Key accepted");
    } catch (err) {
      spinner.stop("Key rejected");
      p.cancel(
        `${err instanceof Error ? err.message : String(err)}\n\n` +
          "Nothing was stored. Re-run with --no-verify to store it anyway.",
      );
      process.exitCode = 1;
      return;
    }
  }

  const path = await writeCredentials(projectDir(), {
    ...(stored ?? {}),
    apiKey,
    ...(opts.apiUrl ? { apiUrl: config.apiUrl } : {}),
  });
  p.log.success(`Stored in ${path} (0600).`);
  p.outro("Signed in.");
}

export async function status(): Promise<void> {
  p.intro("Econome auth");

  const stored = await readCredentials(projectDir());
  const config = resolvePublishConfig({ env: process.env, stored });
  const fromEnv = Boolean(process.env.ECONOME_API_KEY);

  if (!config.apiKey) {
    p.log.warn("No API key configured.");
    p.log.message("Run `econome auth login`, or set ECONOME_API_KEY.");
    p.outro("Signed out.");
    return;
  }

  p.log.info(
    [
      `Key        ${fingerprint(config.apiKey)}`,
      `Source     ${fromEnv ? "ECONOME_API_KEY" : projectDir()}`,
      `API        ${config.apiUrl}`,
      `Gateway    ${config.gatewayUrl}`,
    ].join("\n"),
  );
  if (fromEnv && stored?.apiKey) {
    p.log.warn(
      "A key is also stored on disk. The environment wins, so the stored key is unused.",
    );
  }
  p.outro("Signed in.");
}

export async function logout(): Promise<void> {
  p.intro("Econome auth");
  const removed = await clearCredentials(projectDir());
  if (removed) {
    p.log.success("Stored credentials removed.");
  } else {
    p.log.info("No stored credentials to remove.");
  }
  if (process.env.ECONOME_API_KEY) {
    p.log.warn(
      "ECONOME_API_KEY is still set in this environment and will keep being used.",
    );
  }
  p.outro("Signed out.");
}
