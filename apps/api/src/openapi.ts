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
