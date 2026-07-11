import { describe, expect, it } from "vitest";

import type { PinStatus } from "../src/cluster-client";
import { summarizePinProgress } from "../src/pin-progress";

function st(cid: string, ...statuses: string[]): PinStatus {
  const peers: PinStatus["peers"] = {};
  statuses.forEach((s, i) => {
    peers[`peer-${i}`] = { status: s, timestamp: "" };
  });
  return { cid, peers };
}

describe("summarizePinProgress", () => {
  it("buckets each CID by its most-advanced peer status", () => {
    const p = summarizePinProgress([
      st("a", "pinned"),
      st("b", "pinning"),
      st("c", "pin_queued"),
      st("d", "queued"),
      st("e", "pin_error"),
      st("f", "cluster_error"),
      st("g", "remote"),
      // mixed: pinned on one peer wins over pinning on another
      st("h", "pinning", "pinned"),
    ]);
    expect(p).toEqual({
      total: 8,
      pinned: 2, // a, h
      pinning: 1, // b
      queued: 2, // c, d
      error: 2, // e, f
      other: 1, // g
    });
  });

  it("returns all-zero (bar total) for an empty pinset", () => {
    expect(summarizePinProgress([])).toEqual({
      total: 0,
      pinned: 0,
      pinning: 0,
      queued: 0,
      error: 0,
      other: 0,
    });
  });
});
