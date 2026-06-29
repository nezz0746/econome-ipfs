import { serve } from "@hono/node-server";
import {
  apiKeys,
  contributionSnapshots,
  getDb,
  type NewContributionSnapshot,
  participants,
  runMigrations,
  uploads,
} from "@repo/db";
import { and, eq, isNull } from "drizzle-orm";

import { runAccountingJob } from "./accounting";
import { createApp, type RecordedUpload } from "./app";
import { ClusterClient } from "./cluster-client";
import { loadConfig } from "./config";

const config = loadConfig();
const db = getDb();
const cluster = new ClusterClient(config.clusterApiUrl);

const app = createApp({
  cluster,
  internalToken: config.internalToken,
  replication: config.replication,
  async findApiKey(hashedKey: string) {
    const [row] = await db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(eq(apiKeys.hashedKey, hashedKey), isNull(apiKeys.revokedAt)))
      .limit(1);
    return row;
  },
  async recordUpload(upload: RecordedUpload) {
    await db.insert(uploads).values({
      cid: upload.cid,
      name: upload.name,
      size: upload.size,
      apiKeyId: upload.apiKeyId,
    });
  },
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
    const tick = () =>
      runAccountingJob({ cluster, saveSnapshots, now: () => new Date() }).catch(
        (err) => console.error("[accounting] job failed:", err),
      );
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
