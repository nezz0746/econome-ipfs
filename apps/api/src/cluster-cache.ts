import type { ClusterClient } from "./cluster-client";

/**
 * Memoize a zero-arg async read for `ttlMs`. Concurrent callers share one
 * in-flight promise; a rejection is not cached, so the next call retries.
 */
function withTtl<T>(fn: () => Promise<T>, ttlMs: number): () => Promise<T> {
  let fetchedAt = 0;
  let value: Promise<T> | null = null;
  return () => {
    if (!value || Date.now() - fetchedAt > ttlMs) {
      fetchedAt = Date.now();
      const attempt = fn().catch((err) => {
        if (value === attempt) value = null;
        throw err;
      });
      value = attempt;
    }
    return value;
  };
}

/**
 * Cache the read-heavy cluster calls for `ttlMs`. `pinStatuses` (GET /pins)
 * asks every peer over the network per CID and takes seconds on a large
 * pinset — without a cache every dashboard view pays that cost. Writes
 * (add/pin/unpin) and identity calls pass through untouched; a few seconds
 * of staleness is fine for views that auto-refresh anyway.
 */
export function cacheClusterReads(
  cluster: ClusterClient,
  ttlMs: number,
): ClusterClient {
  const cached = Object.create(cluster) as ClusterClient;
  cached.peers = withTtl(() => cluster.peers(), ttlMs);
  cached.pins = withTtl(() => cluster.pins(), ttlMs);
  cached.pinStatuses = withTtl(() => cluster.pinStatuses(), ttlMs);
  return cached;
}
