import { describe, expect, it, vi } from "vitest";

import { buildSnapshots, runAccountingJob } from "../src/accounting";
import type {
  ClusterClient,
  ClusterPeer,
  PinStatus,
} from "../src/cluster-client";

const peers: ClusterPeer[] = [
  { id: "peer-a", peername: "main", addresses: [] },
  { id: "peer-b", peername: "follower", addresses: [], error: "down" },
];

// Holdings come from the status peer_map. Allocations are irrelevant (and empty
// in a real collaborative cluster): peer-a has both CIDs pinned, peer-b only c1.
const statuses: PinStatus[] = [
  {
    cid: "c1",
    peers: {
      "peer-a": { status: "pinned", timestamp: "" },
      "peer-b": { status: "pinned", timestamp: "" },
    },
  },
  {
    cid: "c2",
    peers: {
      "peer-a": { status: "pinned", timestamp: "" },
    },
  },
];

describe("buildSnapshots", () => {
  it("counts pinned CIDs per peer and flags online status", () => {
    const at = new Date("2026-06-29T00:00:00Z");
    const sizeByCid = new Map([
      ["c1", 100],
      ["c2", 50],
    ]);
    const snaps = buildSnapshots(peers, statuses, sizeByCid, at);

    expect(snaps).toEqual([
      {
        peerId: "peer-a",
        bytesHeld: 150,
        cidCount: 2,
        online: true,
        capturedAt: at,
      },
      {
        peerId: "peer-b",
        bytesHeld: 100,
        cidCount: 1,
        online: false,
        capturedAt: at,
      },
    ]);
  });
});

describe("runAccountingJob", () => {
  it("fetches state, builds and saves snapshots", async () => {
    const cluster = {
      peers: vi.fn(async () => peers),
      pinStatuses: vi.fn(async () => statuses),
    } as unknown as ClusterClient;
    const saveSnapshots = vi.fn(async () => {});
    const at = new Date("2026-06-29T12:00:00Z");

    const count = await runAccountingJob({
      cluster,
      saveSnapshots,
      resolveSizes: async () =>
        new Map<string, number>([
          ["c1", 100],
          ["c2", 50],
        ]),
      now: () => at,
    });

    expect(count).toBe(2);
    expect(saveSnapshots).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ peerId: "peer-a", cidCount: 2 }),
      ]),
      at,
    );
  });
});
