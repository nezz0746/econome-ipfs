import type { NewContributionSnapshot } from "@repo/db";

import type { ClusterClient, ClusterPeer, PinInfo } from "./cluster-client";

/**
 * Build per-peer contribution snapshots from the current cluster state.
 * Pure function so it is trivially testable.
 *
 * - `cidCount`  = number of pins allocated to the peer
 * - `online`    = peer reported no error in /peers
 * - `bytesHeld` = reserved for future pin-size aggregation (0 for now)
 */
export function buildSnapshots(
  peers: ClusterPeer[],
  pins: PinInfo[],
  capturedAt: Date,
): NewContributionSnapshot[] {
  return peers.map((peer) => {
    const cidCount = pins.filter((pin) =>
      pin.allocations.includes(peer.id),
    ).length;
    return {
      peerId: peer.id,
      bytesHeld: 0,
      cidCount,
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
  now: () => Date;
}

/** Fetch current cluster state and persist a contribution snapshot batch. */
export async function runAccountingJob(deps: AccountingDeps): Promise<number> {
  const [peers, pins] = await Promise.all([
    deps.cluster.peers(),
    deps.cluster.pins(),
  ]);
  const capturedAt = deps.now();
  const snapshots = buildSnapshots(peers, pins, capturedAt);
  await deps.saveSnapshots(snapshots, capturedAt);
  return snapshots.length;
}
