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
}

function enrichOne(peer: ClusterPeer, input: PeerViewInput): EnrichedPeer {
  const publicIp = extractPublicIp(peer.addresses);
  const held = input.pins.filter((pin) => pin.allocations.includes(peer.id));
  const bytesHeld = held.reduce(
    (sum, pin) => sum + (input.sizeByCid.get(pin.cid) ?? 0),
    0,
  );
  const participant = input.participants.find((p) => p.peerId === peer.id);
  return {
    id: peer.id,
    peername: peer.peername,
    ipfsId: peer.ipfsId,
    version: peer.version,
    online: !peer.error,
    publicIp,
    geo: publicIp ? (input.geoByIp.get(publicIp) ?? null) : null,
    bytesHeld,
    fileCount: held.length,
    firstSeenAt: participant?.firstSeenAt ?? null,
    lastSeenAt: participant?.lastSeenAt ?? null,
  };
}

export function buildEnrichedPeers(input: PeerViewInput): EnrichedPeer[] {
  return input.peers.map((peer) => enrichOne(peer, input));
}

export function buildPeerDetail(
  peerId: string,
  input: PeerViewInput,
  snapshots: SnapshotRow[],
): PeerDetail | null {
  const peer = input.peers.find((p) => p.id === peerId);
  if (!peer) return null;
  const base = enrichOne(peer, input);
  const statusByCid = new Map(
    input.statuses.map(
      (s): [string, { status: string; timestamp: string } | undefined] => [
        s.cid,
        s.peers[peerId],
      ],
    ),
  );
  const files: PeerFile[] = input.pins
    .filter((pin) => pin.allocations.includes(peerId))
    .map((pin) => {
      const st = statusByCid.get(pin.cid);
      return {
        cid: pin.cid,
        name: pin.name,
        size: input.sizeByCid.get(pin.cid) ?? null,
        syncedAt: st?.timestamp || null,
        status: st?.status ?? "unknown",
      };
    });
  return { ...base, addresses: peer.addresses, files, snapshots };
}
