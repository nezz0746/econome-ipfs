import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  batchFiles,
  formatBytes,
  inspectSite,
  type SiteFile,
  walkSite,
} from "./site";

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "econome-site-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
  return root;
}

function file(relPath: string, size: number): SiteFile {
  return { absPath: `/tmp/${relPath}`, relPath, size };
}

describe("walkSite", () => {
  it("lists files recursively with POSIX relative paths", async () => {
    const root = await fixture({
      "index.html": "<html></html>",
      "assets/app.css": "body{}",
      "nested/deep/page.html": "<html></html>",
    });
    const files = await walkSite(root);
    expect(files.map((f) => f.relPath).sort()).toEqual([
      "assets/app.css",
      "index.html",
      "nested/deep/page.html",
    ]);
  });

  it("skips version control, dependencies and OS noise", async () => {
    const root = await fixture({
      "index.html": "<html></html>",
      ".git/HEAD": "ref: refs/heads/main",
      "node_modules/pkg/index.js": "module.exports={}",
      ".DS_Store": "junk",
      ".env": "SECRET=1",
    });
    const files = await walkSite(root);
    expect(files.map((f) => f.relPath)).toEqual(["index.html"]);
  });

  it("reports real sizes", async () => {
    const root = await fixture({ "index.html": "12345" });
    const [only] = await walkSite(root);
    expect(only?.size).toBe(5);
  });
});

describe("batchFiles", () => {
  it("splits on the file count", () => {
    const files = Array.from({ length: 5 }, (_, i) => file(`f${i}`, 1));
    expect(batchFiles(files, 2, 1000).map((b) => b.length)).toEqual([2, 2, 1]);
  });

  it("splits on the byte budget", () => {
    const files = [file("a", 600), file("b", 600), file("c", 100)];
    expect(
      batchFiles(files, 100, 1000).map((b) => b.map((f) => f.relPath)),
    ).toEqual([["a"], ["b", "c"]]);
  });

  it("keeps a single oversized file rather than dropping it", () => {
    const files = [file("huge", 99_999)];
    expect(batchFiles(files, 10, 10).map((b) => b.length)).toEqual([1]);
  });

  it("returns nothing for no files", () => {
    expect(batchFiles([], 10, 10)).toEqual([]);
  });
});

describe("inspectSite", () => {
  it("warns when there is no index.html at the root", async () => {
    const root = await fixture({ "docs/index.html": "<html></html>" });
    const warnings = await inspectSite(await walkSite(root));
    expect(warnings.map((w) => w.kind)).toContain("no-index");
  });

  it("does not warn when index.html is present", async () => {
    const root = await fixture({ "index.html": "<html></html>" });
    const warnings = await inspectSite(await walkSite(root));
    expect(warnings.map((w) => w.kind)).not.toContain("no-index");
  });

  it("flags root-absolute asset paths that break under /ipfs/<cid>/", async () => {
    const root = await fixture({
      "index.html": '<link href="/styles.css"><script src="/app.js"></script>',
    });
    const warnings = await inspectSite(await walkSite(root));
    expect(warnings.map((w) => w.kind)).toContain("absolute-paths");
  });

  it("accepts relative and protocol-absolute paths", async () => {
    const root = await fixture({
      "index.html":
        '<link href="./styles.css"><script src="https://cdn.example/a.js"></script>',
    });
    const warnings = await inspectSite(await walkSite(root));
    expect(warnings.map((w) => w.kind)).not.toContain("absolute-paths");
  });
});

describe("formatBytes", () => {
  it("formats across units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 kB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
