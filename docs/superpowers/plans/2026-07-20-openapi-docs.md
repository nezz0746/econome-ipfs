# OpenAPI Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generated OpenAPI 3.1 docs for the machine API (`/ingest*`, `/folders*`) at `GET /openapi.json` with a Scalar reference UI at `GET /docs`, linked from the dashboard.

**Architecture:** `hono-openapi` `describeRoute` decorations (backed by zod schemas via `resolver()`) attach documentation to the existing routes without touching handlers or validation; `openAPIRouteHandler(app, …)` serves the generated spec with `/cluster/*` excluded; `@scalar/hono-api-reference` renders the UI. The web dashboard links to `${API_PUBLIC_URL}/docs` (hidden when the var is empty).

**Tech Stack:** hono-openapi (v1), zod (v4), @scalar/hono-api-reference, existing Hono/Next stack.

**Spec:** `docs/superpowers/specs/2026-07-20-openapi-docs-design.md`

## Global Constraints

- Branch: `feat/openapi-docs` (stacked on `feat/mfs-folders-ipns`; already created — work on it).
- **Handlers and validation are untouched** — `describeRoute` middlewares are inserted before existing middleware/handlers; no handler body or validation logic changes. The full pre-existing api suite (146 tests) must stay green.
- Scope: document ONLY `/ingest*` and `/folders*`. `/cluster/*`, `/health`, `/docs`, `/openapi.json` are excluded from the spec.
- Exact names: security scheme `ApiKeyAuth` (`type: apiKey`, `in: header`, `name: x-api-key`); spec at `GET /openapi.json`; UI at `GET /docs`; operation tags `"ingest"` and `"folders"`; spec title `"Econome Storage API"`.
- `/docs` and `/openapi.json` are PUBLIC (mounted outside all auth middleware).
- Web: env var `API_PUBLIC_URL`, code default `"http://localhost:8080"` via `??` (an explicitly empty value means "hide the links" — never render a broken link).
- Node ≥ 22 for tests (`nvm use 22` if the shell resolves Node 18).
- Gates per commit: `pnpm exec biome check --write <paths>`, `pnpm --filter api check-types` / `pnpm --filter web check-types`, `pnpm --filter api test`.
- Every commit message ends with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Deps, `openapi.ts` docs module, `/openapi.json` + `/docs` mounts

**Files:**
- Create: `apps/api/src/openapi.ts`
- Modify: `apps/api/src/app.ts` (imports + one `mountDocs(app)` call after the cors middleware)
- Modify: `apps/api/package.json` (via pnpm add)
- Test: `apps/api/test/app.test.ts` (append)

**Interfaces:**
- Consumes: `createApp` structure in `apps/api/src/app.ts` (the `app.use("*", cors())` line is at the top of `createApp`).
- Produces (used by Tasks 2–3):
  ```ts
  // apps/api/src/openapi.ts
  export const ERROR_SCHEMA: z.ZodType   // z.object({ error: z.string() })
  export const API_KEY_SECURITY: [{ ApiKeyAuth: [] }]  // per-route security value
  export function mountDocs<E extends Env>(app: Hono<E>): void
  ```
  Tasks 2–3 add their `describeRoute` middleware constants to this same file: Task 2 exports `docs` (ingest routes), Task 3 exports `folderDocs` (folder routes).

- [ ] **Step 1: Install dependencies**

```bash
pnpm --filter api add hono-openapi zod @scalar/hono-api-reference
```

Expected: three deps land in `apps/api/package.json`; lockfile updates. (Peer dep `hono` is already present.)

- [ ] **Step 2: Write the failing tests**

Append to `apps/api/test/app.test.ts`:

```ts
describe("docs endpoints", () => {
  it("serves the OpenAPI 3.1 spec publicly with the ApiKeyAuth scheme", async () => {
    const res = await createApp(makeDeps()).request("/openapi.json");
    expect(res.status).toBe(200);
    const spec = (await res.json()) as {
      openapi: string;
      info: { title: string };
      components?: { securitySchemes?: Record<string, unknown> };
      paths?: Record<string, unknown>;
    };
    expect(spec.openapi).toMatch(/^3\.1/);
    expect(spec.info.title).toBe("Econome Storage API");
    expect(spec.components?.securitySchemes?.ApiKeyAuth).toMatchObject({
      type: "apiKey",
      in: "header",
      name: "x-api-key",
    });
    // Internal gateway is never documented.
    for (const path of Object.keys(spec.paths ?? {})) {
      expect(path.startsWith("/cluster")).toBe(false);
    }
  });

  it("serves the Scalar UI publicly", async () => {
    const res = await createApp(makeDeps()).request("/docs");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter api test -- app`
Expected: FAIL — `/openapi.json` and `/docs` return 404 (routes not mounted)

- [ ] **Step 4: Create `apps/api/src/openapi.ts`**

```ts
/**
 * OpenAPI documentation for the machine (API-key) surface: /ingest* and
 * /folders*. Documentation-only — request validation stays hand-rolled in
 * the route handlers; these schemas describe, they do not enforce.
 *
 * The /cluster/* internal gateway (dashboard BFF) is deliberately excluded:
 * it is a private contract. /docs and /openapi.json are public — the spec
 * documents the x-api-key scheme, never key material.
 */

import { Scalar } from "@scalar/hono-api-reference";
import type { Env, Hono } from "hono";
import { openAPIRouteHandler } from "hono-openapi";
import z from "zod";

export const ERROR_SCHEMA = z.object({ error: z.string() });

/** Security requirement applied to every documented route. */
export const API_KEY_SECURITY = [{ ApiKeyAuth: [] as string[] }];

/**
 * Mount GET /openapi.json (generated spec) and GET /docs (Scalar UI).
 * Called from createApp BEFORE any auth middleware — both routes are public.
 */
export function mountDocs<E extends Env>(app: Hono<E>): void {
  app.get(
    "/openapi.json",
    openAPIRouteHandler(app, {
      documentation: {
        info: {
          title: "Econome Storage API",
          version: process.env.npm_package_version ?? "0.1.0",
          description:
            "Machine API for the Econome private IPFS storage center: " +
            "single-file ingest, CID pinning/migration, and mutable MFS " +
            "folders with per-folder IPNS names. Authenticate every call " +
            "with an API key from the dashboard (x-api-key header).",
        },
        components: {
          securitySchemes: {
            ApiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
          },
        },
        tags: [
          { name: "ingest", description: "Single-CID ingest, pin and migration" },
          { name: "folders", description: "Mutable MFS folders with IPNS names" },
        ],
      },
      // The internal gateway mount and the docs/health endpoints stay out.
      exclude: [/^\/cluster(\/|$)/, "/health", "/openapi.json", "/docs"],
    }),
  );

  app.get("/docs", Scalar({ url: "/openapi.json" }));
}
```

- [ ] **Step 5: Mount in `apps/api/src/app.ts`**

Add the import:

```ts
import { mountDocs } from "./openapi";
```

and directly after the existing `app.use("*", cors());` line inside `createApp`, add:

```ts
  // Public API docs (spec + Scalar UI) — mounted before any auth middleware.
  mountDocs(app);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter api test`
Expected: PASS — the 2 new docs tests plus all 146 pre-existing tests

- [ ] **Step 7: Gates + commit**

```bash
pnpm exec biome check --write apps/api
pnpm --filter api check-types
git add apps/api/src/openapi.ts apps/api/src/app.ts apps/api/test/app.test.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): OpenAPI spec endpoint + Scalar docs UI (hono-openapi)"
```

---

### Task 2: Describe the ingest routes

**Files:**
- Modify: `apps/api/src/openapi.ts` (add schemas + `docs` middlewares)
- Modify: `apps/api/src/app.ts` (insert `docs.*` middleware on the 5 ingest routes)
- Test: `apps/api/test/app.test.ts` (append)

**Interfaces:**
- Consumes: `ERROR_SCHEMA`, `API_KEY_SECURITY` (Task 1); `describeRoute`, `resolver` from `hono-openapi`.
- Produces: `export const docs = { ingest, ingestPin, ingestImport, ingestRecord, ingestDelete }` — each a `describeRoute(...)` middleware (Task 3 extends this object with folder entries).

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/app.test.ts` inside the `describe("docs endpoints", …)` block:

```ts
  it("documents every ingest route with ApiKeyAuth", async () => {
    const res = await createApp(makeDeps()).request("/openapi.json");
    const spec = (await res.json()) as {
      paths: Record<string, Record<string, { security?: unknown; tags?: string[] }>>;
    };
    const expects: [string, string][] = [
      ["/ingest", "post"],
      ["/ingest/pin", "post"],
      ["/ingest/import", "post"],
      ["/ingest/record", "post"],
      ["/ingest/{cid}", "delete"],
    ];
    for (const [path, method] of expects) {
      const op = spec.paths[path]?.[method];
      expect(op, `${method.toUpperCase()} ${path}`).toBeDefined();
      expect(op?.security).toEqual([{ ApiKeyAuth: [] }]);
      expect(op?.tags).toEqual(["ingest"]);
    }
  });

  it("describes /ingest as a multipart upload", async () => {
    const res = await createApp(makeDeps()).request("/openapi.json");
    const spec = (await res.json()) as {
      paths: Record<string, { post?: { requestBody?: { content?: Record<string, unknown> } } }>;
    };
    expect(
      spec.paths["/ingest"]?.post?.requestBody?.content?.["multipart/form-data"],
    ).toBeDefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api test -- app`
Expected: FAIL — spec has no `/ingest` paths yet (undescribed routes are excluded)

- [ ] **Step 3: Add ingest schemas + middlewares to `apps/api/src/openapi.ts`**

Add `describeRoute` and `resolver` to the `hono-openapi` import, then append:

```ts
// ----- Shared helpers ------------------------------------------------------

const TAGS_FIELD = z
  .array(z.string())
  .optional()
  .describe(
    "Replication tags (lowercase slugs). Tagged content replicates to the " +
      "main peer plus participants subscribed to one of the tags; untagged " +
      "content stays on the main peer only.",
  );

const jsonContent = (schema: Parameters<typeof resolver>[0]) => ({
  "application/json": { schema: resolver(schema) },
});

const errorResponse = (description: string) => ({
  description,
  content: jsonContent(ERROR_SCHEMA),
});

// ----- Ingest schemas ------------------------------------------------------

const INGEST_RESPONSE = z.object({
  cid: z.string(),
  name: z.string(),
  size: z.number(),
  tags: z.array(z.string()),
});

const PIN_REQUEST = z.object({
  cids: z.array(z.string()).min(1).max(1000),
  tags: TAGS_FIELD,
});

const PIN_RESPONSE = z.object({
  pinned: z.number(),
  failed: z.number(),
  results: z.array(
    z.object({ cid: z.string(), ok: z.boolean(), error: z.string().optional() }),
  ),
});

const IMPORT_REQUEST = z.object({
  cids: z.array(z.string()).min(1).max(1000),
  gateway: z
    .string()
    .optional()
    .describe("CAR-capable HTTP gateway base (default: Pinata's)"),
  tags: TAGS_FIELD,
});

const IMPORT_RESPONSE = z.object({
  imported: z.number(),
  failed: z.number(),
  results: z.array(
    z.object({
      cid: z.string(),
      ok: z.boolean(),
      error: z.string().optional(),
      blocks: z.number().optional(),
      bytes: z.number().optional(),
      recovered: z.boolean().optional(),
    }),
  ),
});

const RECORD_REQUEST = z.object({
  files: z
    .array(
      z.object({
        cid: z.string(),
        size: z.number(),
        name: z.string().optional(),
      }),
    )
    .min(1)
    .max(1000),
});

const RECORD_RESPONSE = z.object({ recorded: z.number(), skipped: z.number() });

const UNPIN_RESPONSE = z.object({ cid: z.string(), unpinned: z.boolean() });

// ----- Route documentation middlewares -------------------------------------

export const docs = {
  ingest: describeRoute({
    tags: ["ingest"],
    security: API_KEY_SECURITY,
    summary: "Upload and pin a single file",
    description:
      "Adds the file to the main node and pins it across the cluster per " +
      "its tags. Returns the resulting CID.",
    requestBody: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            properties: {
              file: { type: "string", format: "binary" },
              tags: {
                type: "string",
                description: "Comma-separated lowercase tag slugs",
              },
            },
            required: ["file"],
          },
        },
      },
    },
    responses: {
      200: { description: "Pinned", content: jsonContent(INGEST_RESPONSE) },
      400: errorResponse("Missing file or invalid tags"),
      401: errorResponse("Missing or invalid API key"),
    },
  }),

  ingestPin: describeRoute({
    tags: ["ingest"],
    security: API_KEY_SECURITY,
    summary: "Pin existing CIDs",
    description:
      "Pins CIDs already retrievable over the IPFS network. CID-preserving.",
    requestBody: {
      required: true,
      content: jsonContent(PIN_REQUEST),
    },
    responses: {
      200: { description: "Per-CID results", content: jsonContent(PIN_RESPONSE) },
      400: errorResponse("Invalid body"),
      401: errorResponse("Missing or invalid API key"),
    },
  }),

  ingestImport: describeRoute({
    tags: ["ingest"],
    security: API_KEY_SECURITY,
    summary: "Import CIDs from an HTTP gateway (CAR)",
    description:
      "CID-preserving migration off an HTTP-only pinning service: fetches " +
      "each DAG as a CARv1 from the gateway, imports the raw blocks, then " +
      "tracks the CID in the cluster.",
    requestBody: {
      required: true,
      content: jsonContent(IMPORT_REQUEST),
    },
    responses: {
      200: { description: "Per-CID results", content: jsonContent(IMPORT_RESPONSE) },
      400: errorResponse("Invalid body"),
      401: errorResponse("Missing or invalid API key"),
    },
  }),

  ingestRecord: describeRoute({
    tags: ["ingest"],
    security: API_KEY_SECURITY,
    summary: "Backfill upload records",
    description:
      "Records already-stored CIDs (with sizes) so they show on the Files " +
      "page. DB-only; idempotent.",
    requestBody: {
      required: true,
      content: jsonContent(RECORD_REQUEST),
    },
    responses: {
      200: { description: "Counts", content: jsonContent(RECORD_RESPONSE) },
      400: errorResponse("Invalid body"),
      401: errorResponse("Missing or invalid API key"),
    },
  }),

  ingestDelete: describeRoute({
    tags: ["ingest"],
    security: API_KEY_SECURITY,
    summary: "Unpin and forget a CID",
    parameters: [
      { name: "cid", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: {
      200: { description: "Unpinned", content: jsonContent(UNPIN_RESPONSE) },
      401: errorResponse("Missing or invalid API key"),
    },
  }),
};
```

- [ ] **Step 4: Decorate the routes in `apps/api/src/app.ts`**

Add `docs` to the `./openapi` import, then insert the middleware as the first argument after the path on each ingest route (handler untouched):

```ts
  app.post("/ingest", docs.ingest, apiKeyAuth(deps.findApiKey), async (c) => {
```

and likewise:

```ts
  app.post("/ingest/pin", docs.ingestPin, apiKeyAuth(deps.findApiKey), async (c) => {
  app.post("/ingest/import", docs.ingestImport, apiKeyAuth(deps.findApiKey), async (c) => {
  app.post("/ingest/record", docs.ingestRecord, apiKeyAuth(deps.findApiKey), async (c) => {
  app.delete("/ingest/:cid", docs.ingestDelete, apiKeyAuth(deps.findApiKey), async (c) => {
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter api test`
Expected: PASS — new docs tests and every pre-existing ingest test (proves handlers untouched)

- [ ] **Step 6: Gates + commit**

```bash
pnpm exec biome check --write apps/api
pnpm --filter api check-types
git add apps/api/src/openapi.ts apps/api/src/app.ts apps/api/test/app.test.ts
git commit -m "feat(api): OpenAPI descriptions for ingest routes"
```

---

### Task 3: Describe the folder routes

**Files:**
- Modify: `apps/api/src/openapi.ts` (folder schemas + extend `docs`)
- Modify: `apps/api/src/folder-routes.ts` (insert `docs.*` middleware on all 9 routes)
- Test: `apps/api/test/app.test.ts` (append)

**Interfaces:**
- Consumes: `jsonContent`, `errorResponse`, `TAGS_FIELD`, `API_KEY_SECURITY` (Tasks 1–2).
- Produces: a NEW export `folderDocs` (separate literal — do NOT merge into `docs`, whose keys must stay statically typed under `noUncheckedIndexedAccess`): `folderDocs.folderCreate`, `.folderList`, `.folderGet`, `.folderUpload`, `.folderCids`, `.folderMove`, `.folderRemovePath`, `.folderSetTags`, `.folderDelete`.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe("docs endpoints", …)` block:

```ts
  it("documents every folder route once, under /folders only", async () => {
    const res = await createApp(makeDeps()).request("/openapi.json");
    const spec = (await res.json()) as {
      paths: Record<string, Record<string, { security?: unknown; tags?: string[] }>>;
    };
    const expects: [string, string][] = [
      ["/folders", "post"],
      ["/folders", "get"],
      ["/folders/{name}", "get"],
      ["/folders/{name}", "patch"],
      ["/folders/{name}", "delete"],
      ["/folders/{name}/files", "post"],
      ["/folders/{name}/files", "delete"],
      ["/folders/{name}/cids", "post"],
      ["/folders/{name}/move", "post"],
    ];
    for (const [path, method] of expects) {
      const op = spec.paths[path]?.[method];
      expect(op, `${method.toUpperCase()} ${path}`).toBeDefined();
      expect(op?.security).toEqual([{ ApiKeyAuth: [] }]);
      expect(op?.tags).toEqual(["folders"]);
    }
    for (const path of Object.keys(spec.paths)) {
      expect(path.startsWith("/cluster")).toBe(false);
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api test -- app`
Expected: FAIL — no `/folders` paths in the spec yet

- [ ] **Step 3: Add folder schemas + middlewares to `apps/api/src/openapi.ts`**

Append:

```ts
// ----- Folder schemas ------------------------------------------------------

const FOLDER_NAME_PARAM = {
  name: "name",
  in: "path" as const,
  required: true,
  schema: { type: "string" as const, pattern: "^[a-z0-9][a-z0-9-]{0,63}$" },
};

const FOLDER_SUMMARY = z.object({
  name: z.string(),
  rootCid: z.string(),
  ipnsName: z.string().nullable().describe("Permanent /ipns/ name (base36)"),
  size: z.number(),
  tags: z.array(z.string()),
});

const FOLDER_ENTRY = z.object({
  name: z.string(),
  type: z.enum(["file", "dir"]),
  size: z.number(),
  cid: z.string(),
});

const FOLDER_DETAIL = FOLDER_SUMMARY.extend({
  path: z.string(),
  entries: z.array(FOLDER_ENTRY),
});

const FOLDER_CREATE_REQUEST = z.object({
  name: z.string().describe("Folder slug: ^[a-z0-9][a-z0-9-]{0,63}$"),
  tags: TAGS_FIELD,
});

const FOLDER_CREATE_RESPONSE = z.object({
  name: z.string(),
  rootCid: z.string(),
  ipnsName: z.string(),
});

const FOLDER_UPLOAD_RESPONSE = z.object({
  added: z.array(z.object({ path: z.string(), cid: z.string() })),
  rootCid: z
    .string()
    .nullable()
    .describe("New folder root, or null when ?commit=false"),
});

const FOLDER_CIDS_REQUEST = z.object({
  entries: z
    .array(z.object({ cid: z.string(), path: z.string() }))
    .min(1)
    .describe("Existing CIDs to mount into the folder tree"),
});

const FOLDER_MOVE_REQUEST = z.object({ from: z.string(), to: z.string() });

const ROOT_CID_RESPONSE = z.object({ rootCid: z.string() });

// ----- Folder route documentation ------------------------------------------

export const folderDocs = {
  folderCreate: describeRoute({
    tags: ["folders"],
    security: API_KEY_SECURITY,
    summary: "Create (or reuse) a folder",
    description:
      "Creates a mutable MFS folder with its own permanent IPNS name. " +
      "Idempotent: re-creating an existing folder re-pins and republishes it.",
    requestBody: { required: true, content: jsonContent(FOLDER_CREATE_REQUEST) },
    responses: {
      200: { description: "Folder", content: jsonContent(FOLDER_CREATE_RESPONSE) },
      400: errorResponse("Invalid name or tags"),
      401: errorResponse("Missing or invalid API key"),
    },
  }),

  folderList: describeRoute({
    tags: ["folders"],
    security: API_KEY_SECURITY,
    summary: "List folders",
    responses: {
      200: {
        description: "Folders",
        content: jsonContent(z.array(FOLDER_SUMMARY)),
      },
      401: errorResponse("Missing or invalid API key"),
    },
  }),

  folderGet: describeRoute({
    tags: ["folders"],
    security: API_KEY_SECURITY,
    summary: "Get a folder's tree at a path",
    parameters: [
      FOLDER_NAME_PARAM,
      {
        name: "path",
        in: "query",
        required: false,
        schema: { type: "string" },
        description: "Relative path inside the folder (default: root)",
      },
    ],
    responses: {
      200: { description: "Folder detail", content: jsonContent(FOLDER_DETAIL) },
      404: errorResponse("Folder not found"),
      401: errorResponse("Missing or invalid API key"),
    },
  }),

  folderUpload: describeRoute({
    tags: ["folders"],
    security: API_KEY_SECURITY,
    summary: "Upload files into a folder",
    description:
      "Multipart upload of one or more files. Repeated `file` parts pair " +
      "1:1 with repeated `path` fields (relative paths; omitted paths fall " +
      "back to the filename). With ?commit=false the files are staged " +
      "without producing a new folder version — send commit=true (default) " +
      "on the final request of a chunked batch.",
    parameters: [
      FOLDER_NAME_PARAM,
      {
        name: "commit",
        in: "query",
        required: false,
        schema: { type: "boolean", default: true },
      },
    ],
    requestBody: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            properties: {
              file: {
                type: "array",
                items: { type: "string", format: "binary" },
              },
              path: {
                type: "array",
                items: { type: "string" },
                description: "Relative destination paths, 1:1 with files",
              },
            },
            required: ["file"],
          },
        },
      },
    },
    responses: {
      200: { description: "Result", content: jsonContent(FOLDER_UPLOAD_RESPONSE) },
      400: errorResponse("Invalid files/paths"),
      404: errorResponse("Folder not found"),
      401: errorResponse("Missing or invalid API key"),
    },
  }),

  folderCids: describeRoute({
    tags: ["folders"],
    security: API_KEY_SECURITY,
    summary: "Mount existing CIDs into a folder",
    parameters: [FOLDER_NAME_PARAM],
    requestBody: { required: true, content: jsonContent(FOLDER_CIDS_REQUEST) },
    responses: {
      200: { description: "New root", content: jsonContent(ROOT_CID_RESPONSE) },
      400: errorResponse("Invalid entries"),
      404: errorResponse("Folder not found"),
      401: errorResponse("Missing or invalid API key"),
    },
  }),

  folderMove: describeRoute({
    tags: ["folders"],
    security: API_KEY_SECURITY,
    summary: "Move/rename a path inside a folder",
    parameters: [FOLDER_NAME_PARAM],
    requestBody: { required: true, content: jsonContent(FOLDER_MOVE_REQUEST) },
    responses: {
      200: { description: "New root", content: jsonContent(ROOT_CID_RESPONSE) },
      400: errorResponse("Invalid paths"),
      404: errorResponse("Folder not found"),
      401: errorResponse("Missing or invalid API key"),
    },
  }),

  folderRemovePath: describeRoute({
    tags: ["folders"],
    security: API_KEY_SECURITY,
    summary: "Remove a file or subdirectory from a folder",
    parameters: [
      FOLDER_NAME_PARAM,
      {
        name: "path",
        in: "query",
        required: true,
        schema: { type: "string" },
      },
    ],
    responses: {
      200: { description: "New root", content: jsonContent(ROOT_CID_RESPONSE) },
      400: errorResponse("Invalid path"),
      404: errorResponse("Folder not found"),
      401: errorResponse("Missing or invalid API key"),
    },
  }),

  folderSetTags: describeRoute({
    tags: ["folders"],
    security: API_KEY_SECURITY,
    summary: "Replace a folder's replication tags",
    parameters: [FOLDER_NAME_PARAM],
    requestBody: {
      required: true,
      content: jsonContent(z.object({ tags: TAGS_FIELD })),
    },
    responses: {
      200: {
        description: "Applied",
        content: jsonContent(z.object({ ok: z.boolean() })),
      },
      400: errorResponse("Invalid tags"),
      404: errorResponse("Folder not found"),
      401: errorResponse("Missing or invalid API key"),
    },
  }),

  folderDelete: describeRoute({
    tags: ["folders"],
    security: API_KEY_SECURITY,
    summary: "Delete a folder",
    description:
      "Releases every cluster pin, removes the MFS directory, and retires " +
      "the IPNS key — the /ipns/ name stops resolving permanently.",
    parameters: [FOLDER_NAME_PARAM],
    responses: {
      200: {
        description: "Deleted",
        content: jsonContent(z.object({ deleted: z.boolean() })),
      },
      401: errorResponse("Missing or invalid API key"),
    },
  }),
};
```

(`docs` from Task 2 stays a plain frozen literal; the folder middlewares live in their own `folderDocs` literal so every key access stays statically typed — a `Record<string, …>` would make dot access `T | undefined` under `noUncheckedIndexedAccess`.)

- [ ] **Step 4: Decorate `apps/api/src/folder-routes.ts`**

Add the import:

```ts
import { folderDocs } from "./openapi";
```

and insert the middleware on each route (handlers untouched):

```ts
  app.post("/", folderDocs.folderCreate, async (c) => {
  app.get("/", folderDocs.folderList, async (c) => c.json(await deps.folders.list()));
  app.get("/:name", folderDocs.folderGet, async (c) => {
  app.post("/:name/files", folderDocs.folderUpload, async (c) => {
  app.post("/:name/cids", folderDocs.folderCids, async (c) => {
  app.post("/:name/move", folderDocs.folderMove, async (c) => {
  app.delete("/:name/files", folderDocs.folderRemovePath, async (c) => {
  app.patch("/:name", folderDocs.folderSetTags, async (c) => {
  app.delete("/:name", folderDocs.folderDelete, async (c) => {
```

Note: the same router is mounted at `/cluster/folders`; the spec's `exclude: [/^\/cluster(\/|$)/]` (Task 1) keeps that duplicate out — the new test asserts it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter api test`
Expected: PASS — including every pre-existing folder-route test

- [ ] **Step 6: Gates + commit**

```bash
pnpm exec biome check --write apps/api
pnpm --filter api check-types
git add apps/api/src/openapi.ts apps/api/src/folder-routes.ts apps/api/test/app.test.ts
git commit -m "feat(api): OpenAPI descriptions for folder routes"
```

---

### Task 4: Dashboard links + compose wiring

**Files:**
- Modify: `apps/web/app/dashboard/page.tsx` (API Docs card)
- Modify: `apps/web/app/dashboard/api-keys/page.tsx` (docs link)
- Modify: `docker-compose.yml`, `docker-compose.prod.yml` (web env)

**Interfaces:**
- Consumes: the API's public `/docs` URL; existing overview-page card pattern (`Card`/`CopyButton`/`ExternalLink` — see the IPFS Gateway card at `apps/web/app/dashboard/page.tsx:50-76`).
- Produces: nothing downstream.

- [ ] **Step 1: Overview page — API Docs card**

In `apps/web/app/dashboard/page.tsx`, add `BookOpen` to the `lucide-react` import, and below the `GATEWAY_URL` constant add:

```ts
// Browser-reachable API base. Empty (prod default until a domain is
// attached) hides the docs card — never render a broken link.
const API_PUBLIC_URL = (
  process.env.API_PUBLIC_URL ?? "http://localhost:8080"
).replace(/\/$/, "");
const API_DOCS_URL = API_PUBLIC_URL ? `${API_PUBLIC_URL}/docs` : null;
```

Then directly after the closing `</Card>` of the IPFS Gateway card, add:

```tsx
      {/* Public machine-API reference (OpenAPI/Scalar). */}
      {API_DOCS_URL ? (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">API Docs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate font-mono text-sm">
                {API_DOCS_URL}
              </code>
              <CopyButton value={API_DOCS_URL} label="Docs URL copied" />
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="Open API docs"
                render={
                  <a href={API_DOCS_URL} target="_blank" rel="noreferrer" />
                }
              >
                <BookOpen className="size-3.5" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Interactive reference for the machine API (ingest &amp; folders)
              — authenticate with an API key.
            </p>
          </CardContent>
        </Card>
      ) : null}
```

- [ ] **Step 2: API Keys page — docs link**

In `apps/web/app/dashboard/api-keys/page.tsx`, add above the component (after the imports):

```ts
const API_PUBLIC_URL = (
  process.env.API_PUBLIC_URL ?? "http://localhost:8080"
).replace(/\/$/, "");
const API_DOCS_URL = API_PUBLIC_URL ? `${API_PUBLIC_URL}/docs` : null;
```

and directly after the `<PageHeader … />` element in the JSX, add:

```tsx
      {API_DOCS_URL ? (
        <p className="text-sm text-muted-foreground">
          Use these keys against the machine API —{" "}
          <a
            className="underline underline-offset-4"
            href={API_DOCS_URL}
            target="_blank"
            rel="noreferrer"
          >
            read the API docs
          </a>
          .
        </p>
      ) : null}
```

- [ ] **Step 3: Compose wiring**

In `docker-compose.yml`, in the `web` service `environment` block (after `IPFS_GATEWAY_URL`), add:

```yaml
      API_PUBLIC_URL: ${API_PUBLIC_URL:-http://localhost:8080}
```

In `docker-compose.prod.yml`, in the `web` service `environment` block, add:

```yaml
      # Browser-reachable API base for dashboard docs links. Leave empty
      # until the api service has a public domain — empty hides the links.
      API_PUBLIC_URL: ${API_PUBLIC_URL:-}
```

Run: `docker compose config >/dev/null && docker compose -f docker-compose.prod.yml config >/dev/null && echo ok`
Expected: `ok` (prod config may require env vars — if it errors on unrelated `:?set` vars, validate with placeholder values, e.g. `DATABASE_URL=x INTERNAL_TOKEN=x docker compose -f docker-compose.prod.yml config >/dev/null`)

- [ ] **Step 4: Gates + commit**

```bash
pnpm exec biome check --write apps/web docker-compose.yml docker-compose.prod.yml
pnpm --filter web check-types
pnpm --filter web build
git add apps/web/app/dashboard/page.tsx apps/web/app/dashboard/api-keys/page.tsx docker-compose.yml docker-compose.prod.yml
git commit -m "feat(web): dashboard links to the API docs via API_PUBLIC_URL"
```

---

### Task 5: Full gates + live smoke

**Files:** none (verification only; commit fixes only if the smoke surfaces issues).

- [ ] **Step 1: Full gates**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
pnpm --filter api test        # expect 149+ passing (146 + new docs tests)
pnpm --filter web test        # expect 15 passing
pnpm --filter api check-types && pnpm --filter web check-types
pnpm exec biome check apps/api apps/web
```

- [ ] **Step 2: Live smoke**

With the dev infra up (`docker compose up -d`) and the API started (`nohup pnpm --filter api dev > /tmp/econome-api-dev.log 2>&1 &`, wait for `/health`):

```bash
curl -s localhost:8080/openapi.json | head -c 400   # spec JSON, title "Econome Storage API"
curl -s localhost:8080/openapi.json | python3 -c "import json,sys; s=json.load(sys.stdin); print(sorted(s['paths']))"
# expect exactly these 10 path keys: /folders, /folders/{name},
# /folders/{name}/cids, /folders/{name}/files, /folders/{name}/move,
# /ingest, /ingest/import, /ingest/pin, /ingest/record, /ingest/{cid}
# — and NOTHING starting with /cluster
curl -s -o /dev/null -w '%{http_code}' localhost:8080/docs   # 200
```

Open `http://localhost:8080/docs` in a browser: Scalar renders both tag groups (ingest, folders), each operation shows the `x-api-key` auth requirement, and the request tester can send a real `GET /folders` with an API key.

Kill the dev API process afterwards (`lsof -ti :8080 | xargs kill`).

- [ ] **Step 3: Hand off**

When green, use superpowers:finishing-a-development-branch for `feat/openapi-docs` (note: stacked on `feat/mfs-folders-ipns` — the PR should target that branch, or wait for PR #19 to merge and retarget main).
