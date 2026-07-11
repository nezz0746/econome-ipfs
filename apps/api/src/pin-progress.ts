import type { PinStatus } from "./cluster-client";

export interface PinProgress {
  total: number;
  pinned: number;
  pinning: number;
  queued: number;
  error: number;
  other: number;
}

type Bucket = "pinned" | "pinning" | "queued" | "error" | "other";

/**
 * Overall status of one CID across the cluster = its most-advanced peer status.
 * (A CID counts as "pinned" as soon as any peer holds it; "pinning"/"queued"
 * while still being fetched; "error" if a peer reports a pin failure.)
 */
function cidStatus(peers: PinStatus["peers"]): Bucket {
  const vals = Object.values(peers).map((p) => p.status.toLowerCase());
  if (vals.some((s) => s === "pinned")) return "pinned";
  if (vals.some((s) => s === "pinning")) return "pinning";
  if (vals.some((s) => s === "queued" || s === "pin_queued")) return "queued";
  if (vals.some((s) => s.includes("error") || s === "unexpectedly_unpinned"))
    return "error";
  return "other";
}

/** Aggregate per-CID pin statuses into headline counts for the dashboard. */
export function summarizePinProgress(statuses: PinStatus[]): PinProgress {
  const p: PinProgress = {
    total: statuses.length,
    pinned: 0,
    pinning: 0,
    queued: 0,
    error: 0,
    other: 0,
  };
  for (const s of statuses) p[cidStatus(s.peers)] += 1;
  return p;
}
