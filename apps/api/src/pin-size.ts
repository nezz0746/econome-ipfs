export interface SizeDeps {
  getCached(cid: string): Promise<number | null>;
  setCached(
    cid: string,
    size: number,
    source: "upload" | "kubo",
  ): Promise<void>;
  /** Size recorded at ingest time (uploads table), if this CID came through us. */
  uploadSize(cid: string): Promise<number | null>;
  ipfsApiUrl: string;
  fetchImpl?: typeof fetch;
}

export interface ResolveOpts {
  /**
   * Skip the Kubo `dag/stat` fallback and resolve only from cache/uploads.
   * Used on request paths (e.g. the peers dashboard) so a large, freshly-pinned
   * pinset can't stall the response on thousands of DAG walks — those sizes are
   * filled in later by the background accounting job.
   */
  cachedOnly?: boolean;
}

/**
 * Resolve a CID's byte size. Cache -> uploads.size -> Kubo dag/stat. A CID's
 * size is immutable, so any resolved value is cached forever. Best-effort:
 * returns null if every source fails. With `cachedOnly`, the Kubo fallback is
 * skipped (returns null instead of walking the DAG).
 */
export async function resolveSize(
  cid: string,
  deps: SizeDeps,
  opts: ResolveOpts = {},
): Promise<number | null> {
  const cached = await deps.getCached(cid);
  if (cached != null) return cached;

  const fromUpload = await deps.uploadSize(cid);
  if (fromUpload != null) {
    await deps.setCached(cid, fromUpload, "upload");
    return fromUpload;
  }

  if (opts.cachedOnly) return null;

  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(
      `${deps.ipfsApiUrl.replace(/\/$/, "")}/api/v0/dag/stat?arg=${encodeURIComponent(cid)}&progress=false`,
      { method: "POST" },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, unknown>;
    const size = Number(body.Size ?? body.size);
    if (!Number.isFinite(size)) return null;
    await deps.setCached(cid, size, "kubo");
    return size;
  } catch {
    return null;
  }
}

/** Resolve many CIDs into a cid->size map, omitting any that fail to resolve. */
export async function resolveSizes(
  cids: string[],
  deps: SizeDeps,
  opts: ResolveOpts = {},
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const unique = [...new Set(cids)];
  const sizes = await Promise.all(
    unique.map((cid) => resolveSize(cid, deps, opts)),
  );
  unique.forEach((cid, i) => {
    const size = sizes[i];
    if (size != null) map.set(cid, size);
  });
  return map;
}
