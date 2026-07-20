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
import { describeRoute, openAPIRouteHandler, resolver } from "hono-openapi";
import z from "zod";

export const ERROR_SCHEMA = z.object({ error: z.string() });

/** Security requirement applied to every documented route. */
export const API_KEY_SECURITY = [{ ApiKeyAuth: [] as string[] }];

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
  "application/json": { schema: resolver(schema) as any },
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
    z.object({
      cid: z.string(),
      ok: z.boolean(),
      error: z.string().optional(),
    }),
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
    requestBody: {
      required: true,
      content: jsonContent(FOLDER_CREATE_REQUEST),
    },
    responses: {
      200: {
        description: "Folder",
        content: jsonContent(FOLDER_CREATE_RESPONSE),
      },
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
      200: {
        description: "Folder detail",
        content: jsonContent(FOLDER_DETAIL),
      },
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
      200: {
        description: "Result",
        content: jsonContent(FOLDER_UPLOAD_RESPONSE),
      },
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
      200: {
        description: "Per-CID results",
        content: jsonContent(PIN_RESPONSE),
      },
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
      200: {
        description: "Per-CID results",
        content: jsonContent(IMPORT_RESPONSE),
      },
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
          {
            name: "ingest",
            description: "Single-CID ingest, pin and migration",
          },
          {
            name: "folders",
            description: "Mutable MFS folders with IPNS names",
          },
        ],
      },
      // The internal gateway mount and the docs/health endpoints stay out.
      exclude: [/^\/cluster(\/|$)/, "/health", "/openapi.json", "/docs"],
    }),
  );

  app.get("/docs", Scalar({ url: "/openapi.json" }));
}
