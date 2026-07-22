import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FoldersApi } from "./folders-api";
import type { SiteFile } from "./site";

interface Captured {
  method: string;
  url: string;
  apiKey: string | undefined;
  contentType: string | undefined;
  body: Buffer;
}

/**
 * Stub of the folders API. The CLI's contract with the server is the thing
 * worth pinning down: field names, the commit flag and the auth header are
 * exactly what silently breaks when either side changes.
 */
async function withServer(
  handler: (req: Captured) => { status: number; body: unknown },
): Promise<{ url: string; calls: Captured[]; close: () => Promise<void> }> {
  const calls: Captured[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const captured: Captured = {
        method: req.method ?? "",
        url: req.url ?? "",
        apiKey: req.headers["x-api-key"] as string | undefined,
        contentType: req.headers["content-type"] as string | undefined,
        body: Buffer.concat(chunks),
      };
      calls.push(captured);
      const { status, body } = handler(captured);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  if (close) await close();
  close = null;
});

async function tempFiles(entries: Record<string, string>): Promise<SiteFile[]> {
  const dir = await mkdtemp(join(tmpdir(), "econome-api-"));
  const out: SiteFile[] = [];
  for (const [rel, content] of Object.entries(entries)) {
    const abs = join(dir, rel.replace(/\//g, "_"));
    await writeFile(abs, content, "utf8");
    out.push({ absPath: abs, relPath: rel, size: content.length });
  }
  return out;
}

describe("FoldersApi", () => {
  it("sends the api key on every request", async () => {
    const srv = await withServer(() => ({ status: 200, body: {} }));
    close = srv.close;
    await new FoldersApi(srv.url, "eco_secret").ensureFolder("site", []);
    expect(srv.calls[0]?.apiKey).toBe("eco_secret");
  });

  it("creates the folder with a JSON body", async () => {
    const srv = await withServer(() => ({ status: 200, body: {} }));
    close = srv.close;
    await new FoldersApi(srv.url, "k").ensureFolder("my-site", ["web"]);
    const call = srv.calls[0];
    expect(call?.method).toBe("POST");
    expect(call?.url).toBe("/folders");
    expect(JSON.parse(call?.body.toString() ?? "{}")).toEqual({
      name: "my-site",
      tags: ["web"],
    });
  });

  it("treats an already-existing folder as success", async () => {
    const srv = await withServer(() => ({
      status: 409,
      body: { error: "folder already exists" },
    }));
    close = srv.close;
    await expect(
      new FoldersApi(srv.url, "k").ensureFolder("site", []),
    ).resolves.toBeUndefined();
  });

  it("still surfaces other creation failures", async () => {
    const srv = await withServer(() => ({
      status: 400,
      body: { error: "invalid name" },
    }));
    close = srv.close;
    await expect(
      new FoldersApi(srv.url, "k").ensureFolder("Bad Name", []),
    ).rejects.toThrow(/invalid name/);
  });

  it("uploads multipart with one path field per file, and the commit flag", async () => {
    const srv = await withServer(() => ({
      status: 200,
      body: { added: [], rootCid: "bafyroot" },
    }));
    close = srv.close;
    const files = await tempFiles({
      "index.html": "<html>",
      "assets/app.css": "body{}",
    });

    const result = await new FoldersApi(srv.url, "k").addFiles(
      "site",
      files,
      false,
    );

    const call = srv.calls[0];
    expect(call?.url).toBe("/folders/site/files?commit=false");
    expect(call?.contentType).toMatch(/^multipart\/form-data/);
    const body = call?.body.toString() ?? "";
    // 1:1 pairing is a server-enforced contract; assert both sides are present.
    expect(body.match(/name="file"/g)?.length).toBe(2);
    expect(body.match(/name="path"/g)?.length).toBe(2);
    expect(body).toContain("index.html");
    expect(body).toContain("assets/app.css");
    expect(result.rootCid).toBe("bafyroot");
  });

  it("passes commit=true when asked", async () => {
    const srv = await withServer(() => ({
      status: 200,
      body: { added: [], rootCid: "bafy" },
    }));
    close = srv.close;
    const files = await tempFiles({ "index.html": "<html>" });
    await new FoldersApi(srv.url, "k").addFiles("site", files, true);
    expect(srv.calls[0]?.url).toBe("/folders/site/files?commit=true");
  });

  it("escapes folder names in the path", async () => {
    const srv = await withServer(() => ({ status: 200, body: null }));
    close = srv.close;
    await new FoldersApi(srv.url, "k").get("a b/c");
    expect(srv.calls[0]?.url).toBe("/folders/a%20b%2Fc");
  });

  it("returns null for a missing folder rather than throwing", async () => {
    const srv = await withServer(() => ({
      status: 404,
      body: { error: "folder not found" },
    }));
    close = srv.close;
    await expect(new FoldersApi(srv.url, "k").get("nope")).resolves.toBeNull();
  });

  it("reports an unreachable server clearly", async () => {
    // Port 1 is reserved and never listening.
    await expect(
      new FoldersApi("http://127.0.0.1:1", "k").ensureFolder("s", []),
    ).rejects.toThrow(/Could not reach/);
  });
});
