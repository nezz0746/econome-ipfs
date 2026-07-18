import { serve } from "@hono/node-server";
import {
  apiKeys,
  contributionSnapshots,
  geoipCache,
  getDb,
  type NewContributionSnapshot,
  participants,
  pinSizes,
  runMigrations,
  uploads,
} from "@repo/db";
import { and, desc, eq, inArray, isNull, max } from "drizzle-orm";

import { runAccountingJob } from "./accounting";
import { createApp, type RecordedUpload } from "./app";
import { ClusterClient } from "./cluster-client";
import { loadConfig } from "./config";
import { createPeerService } from "./peer-service";
import { resolveSizes } from "./pin-size";
import { runReallocationJob } from "./reallocation";

const config = loadConfig();
const db = getDb();
const cluster = new ClusterClient(config.clusterApiUrl);

const GEO_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const pinSizeStore = {
  async get(cid: string) {
    const [row] = await db
      .select({ size: pinSizes.size })
      .from(pinSizes)
      .where(eq(pinSizes.cid, cid))
      .limit(1);
    return row?.size ?? null;
  },
  async set(cid: string, size: number, source: "upload" | "kubo") {
    await db
      .insert(pinSizes)
      .values({ cid, size, source })
      .onConflictDoNothing();
  },
  async uploadSize(cid: string) {
    const [row] = await db
      .select({ size: uploads.size })
      .from(uploads)
      .where(eq(uploads.cid, cid))
      .limit(1);
    return row?.size ?? null;
  },
};

const geoStore = {
  async get(ip: string) {
    const [row] = await db
      .select()
      .from(geoipCache)
      .where(eq(geoipCache.ip, ip))
      .limit(1);
    if (!row) return null;
    if (Date.now() - row.fetchedAt.getTime() > GEO_TTL_MS) return null; // expired -> refetch
    return {
      ip: row.ip,
      countryCode: row.countryCode ?? "",
      country: row.country ?? "",
      city: row.city ?? "",
      lat: row.lat ?? 0,
      lon: row.lon ?? 0,
    };
  },
  async set(geo: {
    ip: string;
    countryCode: string;
    country: string;
    city: string;
    lat: number;
    lon: number;
  }) {
    await db
      .insert(geoipCache)
      .values({ ...geo, fetchedAt: new Date() })
      .onConflictDoUpdate({
        target: geoipCache.ip,
        set: { ...geo, fetchedAt: new Date() },
      });
  },
  /** Newest geo-resolution time across the given IPs, for the "updated at" line. */
  async latestFetchedAt(ips: string[]) {
    if (ips.length === 0) return null;
    const [row] = await db
      .select({ latest: max(geoipCache.fetchedAt) })
      .from(geoipCache)
      .where(inArray(geoipCache.ip, ips));
    return row?.latest ?? null;
  },
};

const peerService = createPeerService({
  cluster,
  ipfsApiUrl: config.ipfsApiUrl,
  geo: geoStore,
  pinSize: pinSizeStore,
  async readParticipants() {
    return db
      .select({
        peerId: participants.peerId,
        label: participants.label,
        subscribedTags: participants.subscribedTags,
        firstSeenAt: participants.firstSeenAt,
        lastSeenAt: participants.lastSeenAt,
      })
      .from(participants);
  },
  async readSnapshots(peerId: string) {
    return db
      .select({
        capturedAt: contributionSnapshots.capturedAt,
        bytesHeld: contributionSnapshots.bytesHeld,
        cidCount: contributionSnapshots.cidCount,
        online: contributionSnapshots.online,
      })
      .from(contributionSnapshots)
      .where(eq(contributionSnapshots.peerId, peerId))
      .orderBy(desc(contributionSnapshots.capturedAt))
      .limit(200);
  },
  // Latest snapshot per peer (one row each) via DISTINCT ON, served by the
  // (peer_id, captured_at DESC) index. Last-known holdings for offline peers.
  async readLastSnapshots() {
    return db
      .selectDistinctOn([contributionSnapshots.peerId], {
        peerId: contributionSnapshots.peerId,
        bytesHeld: contributionSnapshots.bytesHeld,
        cidCount: contributionSnapshots.cidCount,
      })
      .from(contributionSnapshots)
      .orderBy(
        contributionSnapshots.peerId,
        desc(contributionSnapshots.capturedAt),
      );
  },
  // Newest offline snapshot per peer. The current online session began just
  // after this; an aggregate, so it stays a single indexed scan per peer.
  async readLastOffline() {
    const rows = await db
      .select({
        peerId: contributionSnapshots.peerId,
        lastOffline: max(contributionSnapshots.capturedAt),
      })
      .from(contributionSnapshots)
      .where(eq(contributionSnapshots.online, false))
      .groupBy(contributionSnapshots.peerId);
    return rows.flatMap((r) =>
      r.lastOffline ? [{ peerId: r.peerId, lastOffline: r.lastOffline }] : [],
    );
  },
});

async function listTagSubscriptions() {
  return db
    .select({
      peerId: participants.peerId,
      subscribedTags: participants.subscribedTags,
    })
    .from(participants);
}

const app = createApp({
  cluster,
  peerService,
  internalToken: config.internalToken,
  ipfsApiUrl: config.ipfsApiUrl,
  async findApiKey(hashedKey: string) {
    const [row] = await db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(eq(apiKeys.hashedKey, hashedKey), isNull(apiKeys.revokedAt)))
      .limit(1);
    return row;
  },
  async recordUpload(upload: RecordedUpload) {
    // Idempotent on CID (the uploads table has no unique constraint, and the
    // migration path may re-record the same CID): skip if already present.
    const [existing] = await db
      .select({ id: uploads.id })
      .from(uploads)
      .where(eq(uploads.cid, upload.cid))
      .limit(1);
    if (existing) return;
    await db.insert(uploads).values({
      cid: upload.cid,
      name: upload.name,
      size: upload.size,
      tags: upload.tags,
      apiKeyId: upload.apiKeyId,
    });
  },
  async forgetUpload(cid: string) {
    await db.delete(uploads).where(eq(uploads.cid, cid));
  },
  listTagSubscriptions,
});

async function saveSnapshots(
  snapshots: NewContributionSnapshot[],
  capturedAt: Date,
) {
  if (snapshots.length === 0) return;
  await db.insert(contributionSnapshots).values(snapshots);
  for (const snap of snapshots) {
    await db
      .insert(participants)
      .values({ peerId: snap.peerId, lastSeenAt: capturedAt })
      .onConflictDoUpdate({
        target: participants.peerId,
        set: { lastSeenAt: capturedAt },
      });
  }
}

async function migrateWithRetry(attempts = 10, delayMs = 1500) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await runMigrations();
      return;
    } catch (err) {
      if (i === attempts) throw err;
      console.log(
        `[db] not ready (attempt ${i}/${attempts}), retrying in ${delayMs}ms…`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function main() {
  if (process.env.RUN_MIGRATIONS !== "false") {
    console.log("[db] running migrations…");
    await migrateWithRetry();
  }

  if (config.accountingIntervalMs) {
    const interval = config.accountingIntervalMs;
    const tick = () => {
      runAccountingJob({
        cluster,
        saveSnapshots,
        now: () => new Date(),
        resolveSizes: (cids) =>
          resolveSizes(cids, {
            getCached: pinSizeStore.get,
            setCached: pinSizeStore.set,
            uploadSize: pinSizeStore.uploadSize,
            ipfsApiUrl: config.ipfsApiUrl,
          }),
      }).catch((err) => console.error("[accounting] job failed:", err));
      // Converge tagged pins on their subscribed peers (new subscribers,
      // unsubscribes, peers that were offline at pin time).
      runReallocationJob({ cluster, listTagSubscriptions })
        .then((n) => {
          if (n > 0) console.log(`[reallocation] re-pinned ${n} tagged CID(s)`);
        })
        .catch((err) => console.error("[reallocation] job failed:", err));
    };
    setInterval(tick, interval);
    console.log(`[accounting] enabled, every ${interval}ms`);
  }

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`[api] listening on :${info.port}`);
  });
}

main().catch((err) => {
  console.error("[api] failed to start:", err);
  process.exit(1);
});
