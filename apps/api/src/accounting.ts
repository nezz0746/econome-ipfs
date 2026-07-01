import type { NewContributionSnapshot } from "@repo/db";

import type { ClusterClient, ClusterPeer, PinInfo } from "./cluster-client";

/**
 * Build per-peer contribution snapshots from the current cluster state.
 * Pure function so it is trivially testable.
 *
 * - `cidCount`  = number of pins allocated to the peer
 * - `online`    = peer reported no error in /peers
 * - `bytesHeld` = sum of resolved sizes for the peer's pins (0 when unknown)
 */
export function buildSnapshots(
  peers: ClusterPeer[],
  pins: PinInfo[],
  sizeByCid: Map<string, number>,
  capturedAt: Date,
): NewContributionSnapshot[] {
  return peers.map((peer) => {
    const held = pins.filter((pin) => pin.allocations.includes(peer.id));
    const bytesHeld = held.reduce(
      (sum, pin) => sum + (sizeByCid.get(pin.cid) ?? 0),
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
  const [peers, pins] = await Promise.all([
    deps.cluster.peers(),
    deps.cluster.pins(),
  ]);
  const sizeByCid = await deps.resolveSizes(pins.map((p) => p.cid));
  const capturedAt = deps.now();
  const snapshots = buildSnapshots(peers, pins, sizeByCid, capturedAt);
  await deps.saveSnapshots(snapshots, capturedAt);
  return snapshots.length;
}
