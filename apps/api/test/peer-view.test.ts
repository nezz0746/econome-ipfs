import { describe, expect, it } from "vitest";

import type { ClusterPeer, PinInfo, PinStatus } from "../src/cluster-client";
import {
  buildEnrichedPeers,
  buildPeerDetail,
  type PeerViewInput,
} from "../src/peer-view";

const peers: ClusterPeer[] = [
  { id: "peer-a", peername: "main", addresses: [] },
  { id: "peer-b", peername: "follower", addresses: [] },
];

// Collaborative "pin-everywhere" cluster (replication factor -1): the pinset
// carries EMPTY allocations. Real per-peer holdings live in the status peer_map.
const pins: PinInfo[] = [
  {
    cid: "c1",
    name: "one",
    allocations: [],
    replicationFactorMin: -1,
    replicationFactorMax: -1,
  },
  {
    cid: "c2",
    name: "two",
    allocations: [],
    replicationFactorMin: -1,
    replicationFactorMax: -1,
  },
];

const statuses: PinStatus[] = [
  {
    cid: "c1",
    peers: {
      "peer-a": { status: "pinned", timestamp: "2026-07-01T00:00:00Z" },
      "peer-b": { status: "pinned", timestamp: "2026-07-01T00:00:00Z" },
    },
  },
  {
    cid: "c2",
    peers: {
      "peer-a": { status: "pinned", timestamp: "2026-07-01T00:00:00Z" },
      // peer-b is still syncing this one — not yet "synced".
      "peer-b": { status: "pinning", timestamp: "2026-07-01T00:00:00Z" },
    },
  },
];

const input: PeerViewInput = {
  peers,
  pins,
  statuses,
  sizeByCid: new Map([
    ["c1", 100],
    ["c2", 50],
  ]),
  geoByIp: new Map(),
  participants: [],
  lastSnapshotByPeer: new Map(),
  lastOfflineByPeer: new Map(),
};

describe("buildEnrichedPeers (pin-everywhere cluster)", () => {
  it("attributes holdings from the status peer_map, not allocations", () => {
    const byId = new Map(buildEnrichedPeers(input).map((p) => [p.id, p]));
    const a = byId.get("peer-a");
    const b = byId.get("peer-b");
    expect(a?.fileCount).toBe(2);
    expect(a?.bytesHeld).toBe(150);
    // peer-b has c1 pinned but c2 still pinning → only one file synced.
    expect(b?.fileCount).toBe(1);
    expect(b?.bytesHeld).toBe(100);
  });
});

describe("buildEnrichedPeers online/offline history", () => {
  it("sets onlineSince to just after the last offline snapshot", () => {
    const wentOnline = new Date("2026-07-02T10:00:00Z");
    const byId = new Map(
      buildEnrichedPeers({
        ...input,
        lastOfflineByPeer: new Map([["peer-a", wentOnline]]),
      }).map((p) => [p.id, p]),
    );
    expect(byId.get("peer-a")?.onlineSince).toEqual(wentOnline);
    // peer-b never went offline in the record → no session start.
    expect(byId.get("peer-b")?.onlineSince).toBeNull();
  });

  it("includes offline participants with last-known holdings", () => {
    const firstSeen = new Date("2026-06-01T00:00:00Z");
    const lastSeen = new Date("2026-07-03T09:00:00Z");
    const result = buildEnrichedPeers({
      ...input,
      participants: [
        {
          peerId: "peer-a",
          label: "main",
          firstSeenAt: firstSeen,
          lastSeenAt: lastSeen,
        },
        {
          peerId: "gone",
          label: "old-follower",
          firstSeenAt: firstSeen,
          lastSeenAt: lastSeen,
        },
      ],
      lastSnapshotByPeer: new Map([["gone", { bytesHeld: 4200, cidCount: 7 }]]),
    });
    // The two live peers stay, plus the offline "gone" participant is appended.
    expect(result).toHaveLength(3);
    const gone = result.find((p) => p.id === "gone");
    expect(gone?.online).toBe(false);
    expect(gone?.peername).toBe("old-follower");
    expect(gone?.bytesHeld).toBe(4200);
    expect(gone?.fileCount).toBe(7);
    expect(gone?.lastSeenAt).toEqual(lastSeen);
    // A participant that IS live (peer-a) must not be duplicated.
    expect(result.filter((p) => p.id === "peer-a")).toHaveLength(1);
  });
});

describe("buildPeerDetail (pin-everywhere cluster)", () => {
  it("lists synced files from the peer_map with names, sizes and timestamps", () => {
    const detail = buildPeerDetail("peer-a", input, []);
    expect(detail?.files.map((f) => f.cid).sort()).toEqual(["c1", "c2"]);
    expect(detail?.files.every((f) => f.status === "pinned")).toBe(true);
    const c1 = detail?.files.find((f) => f.cid === "c1");
    expect(c1?.name).toBe("one");
    expect(c1?.size).toBe(100);
    expect(c1?.syncedAt).toBe("2026-07-01T00:00:00Z");
  });
});
