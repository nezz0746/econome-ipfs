import { Hono } from "hono";

import type { RecordedUpload } from "./app";
import type { FolderService } from "./folder-service";
import { parseTags } from "./tags";

type Variables = { apiKeyId: string };

export interface FolderRouteDeps {
  folders: FolderService;
  recordUpload: (upload: RecordedUpload) => Promise<void>;
}

/** Map service validation errors to HTTP statuses. */
function errorStatus(err: unknown): 400 | 404 | 500 {
  if (!(err instanceof Error)) return 500;
  if (/^invalid /.test(err.message)) return 400;
  if (/^folder not found/.test(err.message)) return 404;
  return 500;
}

function handle(err: unknown) {
  const status = errorStatus(err);
  if (status === 500) throw err;
  return {
    status,
    body: { error: err instanceof Error ? err.message : "error" },
  } as const;
}

/**
 * Folder routes, auth-agnostic: mounted under /folders (API-key gated,
 * machine clients) AND /cluster/folders (internal token, web BFF).
 */
export function createFolderRoutes(
  deps: FolderRouteDeps,
): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>();

  app.post("/", async (c) => {
    let body: { name?: unknown; tags?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const name = typeof body.name === "string" ? body.name : "";
    const tags = parseTags(body.tags);
    if (tags === null) {
      return c.json({ error: "invalid 'tags': lowercase slugs expected" }, 400);
    }
    try {
      return c.json(await deps.folders.create(name, tags));
    } catch (err) {
      const e = handle(err);
      return c.json(e.body, e.status);
    }
  });

  app.get("/", async (c) => c.json(await deps.folders.list()));

  app.get("/:name", async (c) => {
    const detail = await deps.folders.get(
      c.req.param("name"),
      c.req.query("path") ?? "",
    );
    return detail ? c.json(detail) : c.json({ error: "folder not found" }, 404);
  });

  app.post("/:name/files", async (c) => {
    const name = c.req.param("name");
    const commit = c.req.query("commit") !== "false";
    const body = await c.req.parseBody({ all: true });
    const rawFiles = body.file;
    const rawPaths = body.path;
    const files = (Array.isArray(rawFiles) ? rawFiles : [rawFiles]).filter(
      (f): f is File => f instanceof File,
    );
    const paths = (Array.isArray(rawPaths) ? rawPaths : [rawPaths]).filter(
      (p): p is string => typeof p === "string" && p.length > 0,
    );
    if (files.length === 0) {
      return c.json({ error: "expected multipart field 'file'" }, 400);
    }
    if (paths.length > 0 && paths.length !== files.length) {
      return c.json(
        { error: "'path' fields must match 'file' fields 1:1" },
        400,
      );
    }
    const entries = files.map((file, i) => ({
      content: file as Blob,
      path: paths[i] ?? file.name,
    }));
    try {
      const result = await deps.folders.addFiles(name, entries, { commit });
      const apiKeyId = c.get("apiKeyId") ?? null;
      for (const [i, added] of result.added.entries()) {
        const file = files[i];
        if (!file) continue;
        await deps
          .recordUpload({
            cid: added.cid,
            name: `${name}/${added.path}`,
            size: file.size,
            tags: [],
            apiKeyId,
          })
          .catch(() => {});
      }
      return c.json(result);
    } catch (err) {
      const e = handle(err);
      return c.json(e.body, e.status);
    }
  });

  app.post("/:name/cids", async (c) => {
    let body: { entries?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const entries = Array.isArray(body.entries) ? body.entries : [];
    if (
      entries.length === 0 ||
      !entries.every(
        (e): e is { cid: string; path: string } =>
          typeof (e as { cid?: unknown }).cid === "string" &&
          typeof (e as { path?: unknown }).path === "string",
      )
    ) {
      return c.json(
        { error: "expected 'entries' as a non-empty array of {cid, path}" },
        400,
      );
    }
    try {
      return c.json(await deps.folders.addCids(c.req.param("name"), entries));
    } catch (err) {
      const e = handle(err);
      return c.json(e.body, e.status);
    }
  });

  app.post("/:name/move", async (c) => {
    let body: { from?: unknown; to?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    if (typeof body.from !== "string" || typeof body.to !== "string") {
      return c.json({ error: "expected 'from' and 'to' paths" }, 400);
    }
    try {
      return c.json(
        await deps.folders.movePath(c.req.param("name"), body.from, body.to),
      );
    } catch (err) {
      const e = handle(err);
      return c.json(e.body, e.status);
    }
  });

  app.delete("/:name/files", async (c) => {
    const path = c.req.query("path") ?? "";
    try {
      return c.json(await deps.folders.removePath(c.req.param("name"), path));
    } catch (err) {
      const e = handle(err);
      return c.json(e.body, e.status);
    }
  });

  app.patch("/:name", async (c) => {
    let body: { tags?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const tags = parseTags(body.tags);
    if (tags === null) {
      return c.json({ error: "invalid 'tags': lowercase slugs expected" }, 400);
    }
    try {
      await deps.folders.setTags(c.req.param("name"), tags);
      return c.json({ ok: true });
    } catch (err) {
      const e = handle(err);
      return c.json(e.body, e.status);
    }
  });

  app.delete("/:name", async (c) => {
    try {
      await deps.folders.remove(c.req.param("name"));
      return c.json({ deleted: true });
    } catch (err) {
      const e = handle(err);
      return c.json(e.body, e.status);
    }
  });

  return app;
}
