import { existsSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import * as p from "@clack/prompts";
import { FoldersApi } from "../lib/folders-api.js";
import { projectDir, readCredentials } from "../lib/project.js";
import { explainMissing, resolvePublishConfig } from "../lib/publish-config.js";
import { batchFiles, formatBytes, inspectSite, walkSite } from "../lib/site.js";
import { parseTagsInput } from "../lib/tags.js";

const MAX_FILES_PER_BATCH = 25;
const MAX_BYTES_PER_BATCH = 8 * 1024 * 1024;

export interface PublishOptions {
  name?: string;
  tags?: string;
  dryRun?: boolean;
  yes?: boolean;
  apiUrl?: string;
  gatewayUrl?: string;
}

/** Default folder name from the directory, or its parent for build outputs. */
export function defaultFolderName(dir: string): string {
  const base = basename(resolve(dir));
  const generic = new Set(["dist", "out", "build", "public", "_site", "."]);
  const name = generic.has(base) ? basename(resolve(dir, "..")) : base;
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function publish(
  dir: string,
  opts: PublishOptions,
): Promise<void> {
  p.intro("Econome publish");

  const root = resolve(dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    p.cancel(`Not a directory: ${root}`);
    process.exitCode = 1;
    return;
  }

  const stored = await readCredentials(projectDir());
  const config = resolvePublishConfig({
    env: process.env,
    stored,
    flags: { apiUrl: opts.apiUrl, gatewayUrl: opts.gatewayUrl },
  });

  // A dry run makes no network call, so it must work before any credential is
  // configured: checking the site is exactly what you want to do first.
  if (!opts.dryRun) {
    const problem = explainMissing(config);
    if (problem) {
      p.cancel(problem);
      process.exitCode = 1;
      return;
    }
  }

  const name = (opts.name ?? defaultFolderName(root)).trim();
  if (!name) {
    p.cancel("Could not derive a folder name. Pass --name.");
    process.exitCode = 1;
    return;
  }

  let tags: string[] = [];
  if (opts.tags !== undefined) {
    const parsed = parseTagsInput(opts.tags);
    if (parsed === null) {
      p.cancel("Invalid --tags: comma-separated lowercase slugs expected.");
      process.exitCode = 1;
      return;
    }
    tags = parsed;
  }

  const files = await walkSite(root);
  if (files.length === 0) {
    p.cancel(`No publishable files under ${root}.`);
    process.exitCode = 1;
    return;
  }
  const total = files.reduce((sum, f) => sum + f.size, 0);

  // State the destination before writing anything. Publishing to the wrong
  // environment because nothing said which one is an easy and expensive
  // mistake.
  p.log.info(
    [
      `Directory  ${root}`,
      `Folder     ${name}${tags.length ? `  [${tags.join(", ")}]` : ""}`,
      `Files      ${files.length} (${formatBytes(total)})`,
      `API        ${config.apiUrl}`,
    ].join("\n"),
  );

  for (const warning of await inspectSite(files)) {
    p.log.warn(warning.message);
  }

  if (opts.dryRun) {
    const preview = files.slice(0, 15);
    p.log.message(
      preview.map((f) => `  ${f.relPath}  ${formatBytes(f.size)}`).join("\n") +
        (files.length > preview.length
          ? `\n  … and ${files.length - preview.length} more`
          : ""),
    );
    p.outro("Dry run: nothing was uploaded.");
    return;
  }

  if (!opts.yes) {
    const ok = await p.confirm({
      message: `Publish ${files.length} files to "${name}"? Content on IPFS is public and cannot be reliably unpublished.`,
    });
    if (p.isCancel(ok) || !ok) {
      p.cancel("Cancelled.");
      return;
    }
  }

  const api = new FoldersApi(config.apiUrl, config.apiKey);
  const spinner = p.spinner();

  try {
    spinner.start("Preparing folder");
    await api.ensureFolder(name, tags);

    const batches = batchFiles(files, MAX_FILES_PER_BATCH, MAX_BYTES_PER_BATCH);
    let rootCid: string | null = null;

    for (const [i, batch] of batches.entries()) {
      const last = i === batches.length - 1;
      spinner.message(
        `Uploading ${i + 1}/${batches.length} (${batch.length} files)`,
      );
      const result = await api.addFiles(name, batch, last);
      if (last) rootCid = result.rootCid;
    }

    spinner.stop("Uploaded");

    const summary = await api.get(name);
    const cid = rootCid ?? summary?.rootCid ?? null;
    const lines = [`Folder     ${name}`];
    if (cid) {
      lines.push(`Root CID   ${cid}`);
      lines.push(`URL        ${config.gatewayUrl}/ipfs/${cid}/`);
    }
    if (summary?.ipnsName) {
      lines.push(`IPNS       ${config.gatewayUrl}/ipns/${summary.ipnsName}/`);
      lines.push("");
      lines.push(
        "The IPNS address is stable across publishes; the CID pins this exact",
        "version. IPNS can take a moment to propagate.",
      );
    }
    p.log.success(lines.join("\n"));
    p.outro("Published.");
  } catch (err) {
    spinner.stop("Failed");
    p.cancel(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
