import type { ClusterPeer, PinInfo, PinStatus } from "./cluster-client";
import type { Geo } from "./geoip";
import { extractPublicIp } from "./net";

export interface ParticipantRow {
  peerId: string;
  label: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface SnapshotRow {
  capturedAt: Date;
  bytesHeld: number;
  cidCount: number;
  online: boolean;
}

export interface PeerFile {
  cid: string;
  name: string;
  size: number | null;
  syncedAt: string | null;
  status: string;
}

export interface EnrichedPeer {
  id: string;
  peername: string;
  ipfsId?: string;
  version?: string;
  online: boolean;
  publicIp: string | null;
  geo: Geo | null;
  bytesHeld: number;
  fileCount: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  /** When the current online session began (online peers only), else null. */
  onlineSince: Date | null;
}

export interface PeerLastSnapshot {
  bytesHeld: number;
  cidCount: number;
}

export interface PeerDetail extends EnrichedPeer {
  addresses: string[];
  files: PeerFile[];
  snapshots: SnapshotRow[];
}

export interface PeerViewInput {
  peers: ClusterPeer[];
  pins: PinInfo[];
  statuses: PinStatus[];
  sizeByCid: Map<string, number>;
  geoByIp: Map<string, Geo>;
  participants: ParticipantRow[];
  /** Last-known holdings per peer, for peers that are currently offline. */
  lastSnapshotByPeer: Map<string, PeerLastSnapshot>;
  /** Newest offline snapshot per peer; the online session began just after it. */
  lastOfflineByPeer: Map<string, Date>;
}

/**
 * CIDs a peer has actually synced, taken from the pin status `peer_map`.
 * We can't use pin `allocations`: in a collaborative "pin-everywhere" cluster
 * (replication factor -1) allocations are always empty, so the real record of
 * what a peer holds is its per-CID pin status.
 */
function heldByPeer(peerId: string, input: PeerViewInput): PinStatus[] {
  return input.statuses.filter((s) => s.peers[peerId]?.status === "pinned");
}

function enrichOne(peer: ClusterPeer, input: PeerViewInput): EnrichedPeer {
  const publicIp = extractPublicIp(peer.addresses);
  const held = heldByPeer(peer.id, input);
  const bytesHeld = held.reduce(
    (sum, s) => sum + (input.sizeByCid.get(s.cid) ?? 0),
    0,
  );
  const participant = input.participants.find((p) => p.peerId === peer.id);
  const online = !peer.error;
  return {
    id: peer.id,
    peername: peer.peername,
    ipfsId: peer.ipfsId,
    version: peer.version,
    online,
    publicIp,
    geo: publicIp ? (input.geoByIp.get(publicIp) ?? null) : null,
    bytesHeld,
    fileCount: held.length,
    firstSeenAt: participant?.firstSeenAt ?? null,
    lastSeenAt: participant?.lastSeenAt ?? null,
    // Session started just after the last recorded offline snapshot; fall back
    // to when we first saw the peer if it has never been seen offline.
    onlineSince: online
      ? (input.lastOfflineByPeer.get(peer.id) ??
        participant?.firstSeenAt ??
        null)
      : null,
  };
}

/** A known participant that isn't in the live peer list — render it as offline. */
function buildOfflinePeer(
  participant: ParticipantRow,
  input: PeerViewInput,
): EnrichedPeer {
  const last = input.lastSnapshotByPeer.get(participant.peerId);
  return {
    id: participant.peerId,
    peername: participant.label ?? "",
    online: false,
    publicIp: null,
    geo: null,
    bytesHeld: last?.bytesHeld ?? 0,
    fileCount: last?.cidCount ?? 0,
    firstSeenAt: participant.firstSeenAt,
    lastSeenAt: participant.lastSeenAt,
    onlineSince: null,
  };
}

/**
 * Live cluster peers, plus known participants that are currently offline (in the
 * `participants` table but absent from the live peer list), so the dashboard can
 * show past followers with their last-known holdings and when they dropped off.
 */
export function buildEnrichedPeers(input: PeerViewInput): EnrichedPeer[] {
  const live = input.peers.map((peer) => enrichOne(peer, input));
  const liveIds = new Set(input.peers.map((p) => p.id));
  const offline = input.participants
    .filter((p) => !liveIds.has(p.peerId))
    .map((p) => buildOfflinePeer(p, input));
  return [...live, ...offline];
}

export function buildPeerDetail(
  peerId: string,
  input: PeerViewInput,
  snapshots: SnapshotRow[],
): PeerDetail | null {
  const peer = input.peers.find((p) => p.id === peerId);
  if (!peer) return null;
  const base = enrichOne(peer, input);
  const nameByCid = new Map(input.pins.map((pin) => [pin.cid, pin.name]));
  const files: PeerFile[] = heldByPeer(peerId, input).map((s) => {
    const st = s.peers[peerId];
    return {
      cid: s.cid,
      name: nameByCid.get(s.cid) ?? "",
      size: input.sizeByCid.get(s.cid) ?? null,
      syncedAt: st?.timestamp || null,
      status: st?.status ?? "unknown",
    };
  });
  return { ...base, addresses: peer.addresses, files, snapshots };
}
