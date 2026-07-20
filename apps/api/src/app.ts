import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { type ApiKeyRecord, apiKeyAuth, internalAuth } from "./auth";
import { importCidFromGateway } from "./car-import";
import type { ClusterClient, PinOptions } from "./cluster-client";
import { createFolderRoutes } from "./folder-routes";
import type { FolderService } from "./folder-service";
import { docs, mountDocs } from "./openapi";
import type { PeerService } from "./peer-service";
import { summarizePinProgress } from "./pin-progress";
import { parseTags, type TagSubscription, tagPinOptions } from "./tags";

export interface RecordedUpload {
  cid: string;
  name: string | null;
  size: number;
  tags: string[];
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
  /** Participants' tag subscriptions, to resolve tagged-pin allocations. */
  listTagSubscriptions: () => Promise<TagSubscription[]>;
  /** kubo HTTP API base (e.g. http://kubo:5001), for CID-preserving CAR import. */
  ipfsApiUrl: string;
  /** Enriched peer views (files, geo, bytes, history) for the dashboard. */
  peerService: PeerService;
  /** MFS-backed folders (create/mutate/list + reconcile). */
  folders: FolderService;
}

type Variables = { apiKeyId: string };

/** Max CIDs accepted in a single pin-by-CID request. */
const PIN_BATCH_MAX = 1000;
/** In-flight pin requests to the cluster per batch. */
const PIN_CONCURRENCY = 8;

/** Default HTTP gateway for CID-preserving migration (CAR-capable). */
const DEFAULT_IMPORT_GATEWAY = "https://gateway.pinata.cloud";
/** In-flight CAR fetch+import operations per batch (each moves real bytes). */
const IMPORT_CONCURRENCY = 5;

/** Run `fn` over `items` with at most `limit` in flight; preserves order. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

export function createApp(deps: AppDeps): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>();

  app.use("*", logger());
  app.use("*", cors());

  // Public API docs (spec + Scalar UI) — mounted before any auth middleware.
  mountDocs(app);

  // The cluster peer id is static for the process; resolve it once, lazily,
  // and retry on failure rather than caching a rejection.
  let mainPeerId: Promise<string> | null = null;
  const getMainPeerId = () => {
    mainPeerId ??= deps.cluster.id().catch((err) => {
      mainPeerId = null;
      throw err;
    });
    return mainPeerId;
  };

  /**
   * Pin options for the given tags. Replication is opt-in: untagged content
   * is pinned to the main peer only; tagged content is allocated explicitly
   * to the main peer + subscribed participants, and carries its tags in pin
   * metadata so the reallocation job can reconcile it later.
   */
  async function pinOptionsForTags(tags: string[]): Promise<PinOptions> {
    return tagPinOptions(
      tags,
      await getMainPeerId(),
      await deps.listTagSubscriptions(),
    );
  }

  app.get("/health", (c) => c.json({ ok: true }));

  // ----- Ingest (machine clients, API-key gated) -------------------------
  app.post("/ingest", docs.ingest, apiKeyAuth(deps.findApiKey), async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) {
      return c.json({ error: "expected multipart field 'file'" }, 400);
    }
    const tags = parseTags(body.tags);
    if (tags === null) {
      return c.json(
        { error: "invalid 'tags': comma-separated lowercase slugs expected" },
        400,
      );
    }

    const form = new FormData();
    form.append("file", file, file.name);

    const result = await deps.cluster.add(form, await pinOptionsForTags(tags));

    await deps.recordUpload({
      cid: result.cid,
      name: file.name || null,
      size: result.size,
      tags,
      apiKeyId: c.get("apiKeyId") ?? null,
    });

    return c.json({
      cid: result.cid,
      name: result.name,
      size: result.size,
      tags,
    });
  });

  // Pin existing CIDs into the cluster — e.g. migrating a pinset off another
  // pinning service. Preserves CIDs; the cluster fetches the content over the
  // IPFS network and replicates it. No upload record is written: size and
  // provenance resolve later from Kubo (dag/stat), so we never seed a bogus 0.
  app.post(
    "/ingest/pin",
    docs.ingestPin,
    apiKeyAuth(deps.findApiKey),
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "invalid JSON body" }, 400);
      }

      const cids = (body as { cids?: unknown }).cids;
      if (
        !Array.isArray(cids) ||
        cids.length === 0 ||
        cids.length > PIN_BATCH_MAX ||
        !cids.every((cid) => typeof cid === "string" && cid.length > 0)
      ) {
        return c.json(
          {
            error: `expected 'cids' to be a non-empty array of up to ${PIN_BATCH_MAX} CID strings`,
          },
          400,
        );
      }
      const tags = parseTags((body as { tags?: unknown }).tags);
      if (tags === null) {
        return c.json(
          { error: "invalid 'tags': array of lowercase slugs expected" },
          400,
        );
      }
      const pinOpts = await pinOptionsForTags(tags);

      const results = await mapPool(
        cids as string[],
        PIN_CONCURRENCY,
        async (cid) => {
          try {
            await deps.cluster.pinByCid(cid, pinOpts);
            return { cid, ok: true as const };
          } catch (e) {
            return {
              cid,
              ok: false as const,
              error: e instanceof Error ? e.message : "pin failed",
            };
          }
        },
      );

      const failed = results.filter((r) => !r.ok).length;
      return c.json({ pinned: results.length - failed, failed, results });
    },
  );

  // CID-preserving migration off an HTTP-only pinning service (e.g. Pinata):
  // fetch each CID's DAG as a CAR from a gateway, import the raw blocks into
  // kubo (preserving the CID), then track+replicate it in the cluster. Verifies
  // the imported root equals the requested CID.
  app.post(
    "/ingest/import",
    docs.ingestImport,
    apiKeyAuth(deps.findApiKey),
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "invalid JSON body" }, 400);
      }

      const cids = (body as { cids?: unknown }).cids;
      const rawGateway = (body as { gateway?: unknown }).gateway;
      const gateway =
        typeof rawGateway === "string" && rawGateway.length > 0
          ? rawGateway
          : DEFAULT_IMPORT_GATEWAY;

      if (
        !Array.isArray(cids) ||
        cids.length === 0 ||
        cids.length > PIN_BATCH_MAX ||
        !cids.every((cid) => typeof cid === "string" && cid.length > 0)
      ) {
        return c.json(
          {
            error: `expected 'cids' to be a non-empty array of up to ${PIN_BATCH_MAX} CID strings`,
          },
          400,
        );
      }
      const tags = parseTags((body as { tags?: unknown }).tags);
      if (tags === null) {
        return c.json(
          { error: "invalid 'tags': array of lowercase slugs expected" },
          400,
        );
      }
      const pinOpts = await pinOptionsForTags(tags);

      const apiKeyId = c.get("apiKeyId") ?? null;
      const results = await mapPool(
        cids as string[],
        IMPORT_CONCURRENCY,
        async (cid) => {
          const r = await importCidFromGateway(cid, {
            gateway,
            ipfsApiUrl: deps.ipfsApiUrl,
          });
          if (!r.ok) return r;
          // Content is now local in kubo; tracking it in the cluster completes
          // instantly and replicates it to followers.
          try {
            await deps.cluster.pinByCid(cid, pinOpts);
          } catch (e) {
            return {
              ...r,
              ok: false,
              error: `imported_but_cluster_pin_failed: ${
                e instanceof Error ? e.message : "unknown"
              }`,
            };
          }
          // Record it (with the real DAG size) so it shows on the Files page and
          // its size resolves instantly (no dag/stat). Idempotent, best-effort.
          if (typeof r.bytes === "number" && r.bytes > 0) {
            await deps
              .recordUpload({ cid, name: null, size: r.bytes, tags, apiKeyId })
              .catch(() => {});
          }
          return r;
        },
      );

      const imported = results.filter((r) => r.ok).length;
      return c.json({ imported, failed: results.length - imported, results });
    },
  );

  // Backfill: record already-stored CIDs (with sizes) in the uploads table so
  // they show on the Files page. For content migrated via pin/import, which
  // stores bytes without an upload record. DB-only (no kubo/gateway), idempotent.
  app.post(
    "/ingest/record",
    docs.ingestRecord,
    apiKeyAuth(deps.findApiKey),
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "invalid JSON body" }, 400);
      }

      const files = (body as { files?: unknown }).files;
      if (
        !Array.isArray(files) ||
        files.length === 0 ||
        files.length > PIN_BATCH_MAX
      ) {
        return c.json(
          {
            error: `expected 'files' to be a non-empty array of up to ${PIN_BATCH_MAX} {cid,size} entries`,
          },
          400,
        );
      }

      const apiKeyId = c.get("apiKeyId") ?? null;
      let recorded = 0;
      let skipped = 0;
      for (const f of files) {
        const cid = (f as { cid?: unknown }).cid;
        const size = Number((f as { size?: unknown }).size);
        const name = (f as { name?: unknown }).name;
        if (
          typeof cid !== "string" ||
          cid.length === 0 ||
          !Number.isFinite(size)
        ) {
          skipped += 1;
          continue;
        }
        await deps
          .recordUpload({
            cid,
            name: typeof name === "string" ? name : null,
            size,
            tags: [],
            apiKeyId,
          })
          .catch(() => {});
        recorded += 1;
      }
      return c.json({ recorded, skipped });
    },
  );

  // Unpin + forget a CID (used by external integrations on asset deletion).
  app.delete(
    "/ingest/:cid",
    docs.ingestDelete,
    apiKeyAuth(deps.findApiKey),
    async (c) => {
      const cid = c.req.param("cid");
      await deps.cluster.unpin(cid);
      await deps.forgetUpload(cid);
      return c.json({ cid, unpinned: true });
    },
  );

  // ----- Folders (MFS + IPNS) --------------------------------------------
  // Mounted twice: /folders for machine clients (API key), and under the
  // internal-token gateway below for the dashboard BFF.
  const folderRoutes = createFolderRoutes({
    folders: deps.folders,
    recordUpload: deps.recordUpload,
  });
  app.use("/folders", apiKeyAuth(deps.findApiKey));
  app.use("/folders/*", apiKeyAuth(deps.findApiKey));
  app.route("/folders", folderRoutes);

  // ----- Cluster gateway (dashboard via Next BFF, internal-token gated) ---
  const gateway = new Hono<{ Variables: Variables }>();
  gateway.use("*", internalAuth(deps.internalToken));

  gateway.get("/peers", async (c) => c.json(await deps.cluster.peers()));
  gateway.get("/peers/enriched", async (c) => {
    // `?refresh=1` forces a fresh geo lookup, bypassing the 30-day geo cache.
    const force = c.req.query("refresh") === "1";
    return c.json(await deps.peerService.enrichedPeers({ force }));
  });
  gateway.get("/peers/:peerId", async (c) => {
    const detail = await deps.peerService.peerDetail(c.req.param("peerId"));
    return detail ? c.json(detail) : c.json({ error: "peer not found" }, 404);
  });
  gateway.get("/pins", async (c) => c.json(await deps.cluster.pins()));
  gateway.get("/health", async (c) => c.json(await deps.cluster.healthGraph()));

  // Live migration/pin progress: how much of the pinset is pinned vs still
  // being fetched. Cheap (one cluster status call, no per-CID DAG walks).
  gateway.get("/pin-progress", async (c) =>
    c.json(summarizePinProgress(await deps.cluster.pinStatuses())),
  );

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

  gateway.route("/folders", folderRoutes);

  app.route("/cluster", gateway);

  return app;
}
