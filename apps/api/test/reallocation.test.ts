import { describe, expect, it, vi } from "vitest";

import type { ClusterClient } from "../src/cluster-client";
import { runReallocationJob } from "../src/reallocation";

function fakeCluster(overrides: Partial<ClusterClient> = {}): ClusterClient {
  return {
    id: vi.fn(async () => "main"),
    peers: vi.fn(async () => [
      { id: "main", peername: "main", addresses: [] },
      { id: "peer-b", peername: "b", addresses: [] },
    ]),
    pins: vi.fn(async () => [
      // Tagged pin missing its online subscriber peer-b.
      {
        cid: "c1",
        name: "one",
        allocations: ["main"],
        replicationFactorMin: 1,
        replicationFactorMax: 1,
        metadata: { tags: "photos" },
      },
      // Untagged pin: never touched.
      {
        cid: "c2",
        name: "two",
        allocations: [],
        replicationFactorMin: -1,
        replicationFactorMax: -1,
        metadata: {},
      },
    ]),
    pinByCid: vi.fn(async () => {}),
    ...overrides,
  } as unknown as ClusterClient;
}

describe("runReallocationJob", () => {
  it("re-pins tagged pins whose online subscribers are missing", async () => {
    const cluster = fakeCluster();
    const repinned = await runReallocationJob({
      cluster,
      listTagSubscriptions: async () => [
        { peerId: "peer-b", subscribedTags: ["photos"] },
      ],
    });
    expect(repinned).toBe(1);
    expect(cluster.pinByCid).toHaveBeenCalledTimes(1);
    expect(cluster.pinByCid).toHaveBeenCalledWith("c1", {
      replicationMin: 1,
      replicationMax: 2,
      userAllocations: ["main", "peer-b"],
      name: "one",
      metadata: { tags: "photos" },
    });
  });

  it("does nothing when allocations are converged", async () => {
    const cluster = fakeCluster();
    const repinned = await runReallocationJob({
      cluster,
      listTagSubscriptions: async () => [], // nobody subscribed; c1 -> [main] already
    });
    expect(repinned).toBe(0);
    expect(cluster.pinByCid).not.toHaveBeenCalled();
  });

  it("keeps going when one re-pin fails", async () => {
    const cluster = fakeCluster({
      pins: vi.fn(async () => [
        {
          cid: "c1",
          name: "",
          allocations: ["main"],
          replicationFactorMin: 1,
          replicationFactorMax: 1,
          metadata: { tags: "photos" },
        },
        {
          cid: "c3",
          name: "",
          allocations: ["main"],
          replicationFactorMin: 1,
          replicationFactorMax: 1,
          metadata: { tags: "photos" },
        },
      ]),
      pinByCid: vi.fn(async (cid: string) => {
        if (cid === "c1") throw new Error("boom");
      }),
    });
    const repinned = await runReallocationJob({
      cluster,
      listTagSubscriptions: async () => [
        { peerId: "peer-b", subscribedTags: ["photos"] },
      ],
    });
    expect(repinned).toBe(1);
    expect(cluster.pinByCid).toHaveBeenCalledTimes(2);
  });
});
