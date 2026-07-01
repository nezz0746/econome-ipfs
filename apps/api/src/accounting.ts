import type { NewContributionSnapshot } from "@repo/db";

import type { ClusterClient, ClusterPeer, PinStatus } from "./cluster-client";

/**
 * Build per-peer contribution snapshots from the current cluster state.
 * Pure function so it is trivially testable.
 *
 * Holdings come from the pin status `peer_map`, not pin `allocations`: a
 * collaborative "pin-everywhere" cluster (replication factor -1) leaves
 * allocations empty, so the status is the only record of what a peer holds.
 *
 * - `cidCount`  = number of CIDs the peer has pinned
 * - `online`    = peer reported no error in /peers
 * - `bytesHeld` = sum of resolved sizes for the peer's pins (0 when unknown)
 */
export function buildSnapshots(
  peers: ClusterPeer[],
  statuses: PinStatus[],
  sizeByCid: Map<string, number>,
  capturedAt: Date,
): NewContributionSnapshot[] {
  return peers.map((peer) => {
    const held = statuses.filter((s) => s.peers[peer.id]?.status === "pinned");
    const bytesHeld = held.reduce(
      (sum, s) => sum + (sizeByCid.get(s.cid) ?? 0),
      0,
    );
    return {
      peerId: peer.id,
      bytesHeld,
      cidCount: held.length,
      online: !peer.error,
      capturedAt,
    };
  });
}

export interface AccountingDeps {
  cluster: ClusterClient;
  /** Persist a batch of snapshots and touch participant last-seen timestamps. */
  saveSnapshots: (
    snapshots: NewContributionSnapshot[],
    capturedAt: Date,
  ) => Promise<void>;
  /** Resolve sizes for the given CIDs (populates the pin_sizes cache). */
  resolveSizes: (cids: string[]) => Promise<Map<string, number>>;
  now: () => Date;
}

/** Fetch current cluster state and persist a contribution snapshot batch. */
export async function runAccountingJob(deps: AccountingDeps): Promise<number> {
  const [peers, statuses] = await Promise.all([
    deps.cluster.peers(),
    deps.cluster.pinStatuses(),
  ]);
  const sizeByCid = await deps.resolveSizes(statuses.map((s) => s.cid));
  const capturedAt = deps.now();
  const snapshots = buildSnapshots(peers, statuses, sizeByCid, capturedAt);
  await deps.saveSnapshots(snapshots, capturedAt);
  return snapshots.length;
}
