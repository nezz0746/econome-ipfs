import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { type ApiKeyRecord, apiKeyAuth, internalAuth } from "./auth";
import type { ClusterClient } from "./cluster-client";

export interface RecordedUpload {
  cid: string;
  name: string | null;
  size: number;
  apiKeyId: string | null;
}

export interface AppDeps {
  cluster: ClusterClient;
  internalToken: string;
  /** Look up a non-revoked API key by its hash. */
  findApiKey: (hashedKey: string) => Promise<ApiKeyRecord | undefined>;
  /** Persist a successful ingest. */
  recordUpload: (upload: RecordedUpload) => Promise<void>;
  /** Remove ingest records for a CID (called when it is unpinned). */
  forgetUpload: (cid: string) => Promise<void>;
  replication: { min: number; max: number };
}

type Variables = { apiKeyId: string };

export function createApp(deps: AppDeps): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>();

  app.use("*", logger());
  app.use("*", cors());

  app.get("/health", (c) => c.json({ ok: true }));

  // ----- Ingest (machine clients, API-key gated) -------------------------
  app.post("/ingest", apiKeyAuth(deps.findApiKey), async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) {
      return c.json({ error: "expected multipart field 'file'" }, 400);
    }

    const form = new FormData();
    form.append("file", file, file.name);

    const result = await deps.cluster.add(form, {
      replicationMin: deps.replication.min,
      replicationMax: deps.replication.max,
    });

    await deps.recordUpload({
      cid: result.cid,
      name: file.name || null,
      size: result.size,
      apiKeyId: c.get("apiKeyId") ?? null,
    });

    return c.json({ cid: result.cid, name: result.name, size: result.size });
  });

  // Unpin + forget a CID (used by external integrations on asset deletion).
  app.delete("/ingest/:cid", apiKeyAuth(deps.findApiKey), async (c) => {
    const cid = c.req.param("cid");
    await deps.cluster.unpin(cid);
    await deps.forgetUpload(cid);
    return c.json({ cid, unpinned: true });
  });

  // ----- Cluster gateway (dashboard via Next BFF, internal-token gated) ---
  const gateway = new Hono<{ Variables: Variables }>();
  gateway.use("*", internalAuth(deps.internalToken));

  gateway.get("/peers", async (c) => c.json(await deps.cluster.peers()));
  gateway.get("/pins", async (c) => c.json(await deps.cluster.pins()));
  gateway.get("/health", async (c) => c.json(await deps.cluster.healthGraph()));

  gateway.get("/overview", async (c) => {
    const [peers, pins] = await Promise.all([
      deps.cluster.peers(),
      deps.cluster.pins(),
    ]);
    const onlinePeers = peers.filter((p) => !p.error).length;
    const underReplicated = pins.filter(
      (p) =>
        p.replicationFactorMin > 0 &&
        p.allocations.length < p.replicationFactorMin,
    ).length;
    return c.json({
      peerCount: peers.length,
      onlinePeers,
      totalPins: pins.length,
      underReplicated,
    });
  });

  app.route("/cluster", gateway);

  return app;
}
