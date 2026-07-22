import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export interface SiteFile {
  /** Absolute path on disk. */
  absPath: string;
  /** Path inside the folder, always POSIX-separated. */
  relPath: string;
  size: number;
}

/**
 * Never uploaded. Version control and dependency directories are large,
 * private, and never part of a built site; the rest are editor and OS noise.
 */
const IGNORED = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".DS_Store",
  "Thumbs.db",
  ".env",
  ".env.local",
]);

function isIgnored(name: string): boolean {
  return IGNORED.has(name) || name.endsWith(".swp");
}

/** Recursively list publishable files, depth-first and sorted for stable output. */
export async function walkSite(root: string): Promise<SiteFile[]> {
  const out: SiteFile[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of [...entries].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (isIgnored(entry.name)) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        const info = await stat(abs);
        out.push({
          absPath: abs,
          relPath: relative(root, abs).split(sep).join("/"),
          size: info.size,
        });
      }
    }
  }

  await walk(root);
  return out;
}

/** Split into batches bounded by both file count and total bytes. */
export function batchFiles(
  files: SiteFile[],
  maxFiles: number,
  maxBytes: number,
): SiteFile[][] {
  const batches: SiteFile[][] = [];
  let current: SiteFile[] = [];
  let bytes = 0;

  for (const file of files) {
    // A single oversized file still goes out on its own rather than being
    // dropped: the server decides whether it is too large, not us.
    if (
      current.length > 0 &&
      (current.length >= maxFiles || bytes + file.size > maxBytes)
    ) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(file);
    bytes += file.size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export interface SiteWarning {
  kind: "no-index" | "absolute-paths";
  message: string;
}

const ABSOLUTE_REF = /(?:src|href)\s*=\s*["']\/(?!\/)[^"']*["']/g;

/**
 * Checks that catch the two mistakes that actually happen when publishing a
 * site to a content-addressed gateway.
 */
export async function inspectSite(files: SiteFile[]): Promise<SiteWarning[]> {
  const warnings: SiteWarning[] = [];

  if (!files.some((f) => f.relPath === "index.html")) {
    warnings.push({
      kind: "no-index",
      message:
        "No index.html at the root of this directory. A gateway will show a " +
        "file listing instead of a site. Did you mean to publish the build " +
        "output (dist/, out/, build/) rather than the project root?",
    });
  }

  // Served from /ipfs/<cid>/, a root-absolute asset resolves to the gateway
  // root and 404s. This is the single most common reason a published site
  // renders unstyled.
  const html = files.filter((f) => f.relPath.endsWith(".html")).slice(0, 20);
  const offenders: string[] = [];
  for (const file of html) {
    try {
      const text = await readFile(file.absPath, "utf8");
      if (ABSOLUTE_REF.test(text)) offenders.push(file.relPath);
      ABSOLUTE_REF.lastIndex = 0;
    } catch {
      // Unreadable file is not this check's problem; the upload will report it.
    }
  }
  if (offenders.length > 0) {
    warnings.push({
      kind: "absolute-paths",
      message:
        `Root-absolute asset paths found in ${offenders.slice(0, 3).join(", ")}` +
        `${offenders.length > 3 ? ` and ${offenders.length - 3} more` : ""}. ` +
        "Served under /ipfs/<cid>/ these resolve to the gateway root and will " +
        "404. Build with relative paths, or serve the folder from a domain " +
        "root via its IPNS name.",
    });
  }

  return warnings;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["kB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
