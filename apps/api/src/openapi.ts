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
