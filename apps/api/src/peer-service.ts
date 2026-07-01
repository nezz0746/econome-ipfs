import type { ClusterClient } from "./cluster-client";
import type { Geo } from "./geoip";
import { resolveGeo } from "./geoip";
import { extractPublicIp } from "./net";
import {
  buildEnrichedPeers,
  buildPeerDetail,
  type EnrichedPeer,
  type ParticipantRow,
  type PeerDetail,
  type PeerViewInput,
  type SnapshotRow,
} from "./peer-view";
import { resolveSizes, type SizeDeps } from "./pin-size";

export interface PeerServiceDeps {
  cluster: ClusterClient;
  ipfsApiUrl: string;
  geo: { get(ip: string): Promise<Geo | null>; set(geo: Geo): Promise<void> };
  pinSize: {
    get(cid: string): Promise<number | null>;
    set(cid: string, size: number, source: "upload" | "kubo"): Promise<void>;
    uploadSize(cid: string): Promise<number | null>;
  };
  readParticipants(): Promise<ParticipantRow[]>;
  readSnapshots(peerId: string): Promise<SnapshotRow[]>;
  fetchImpl?: typeof fetch;
}

export interface PeerService {
  enrichedPeers(): Promise<EnrichedPeer[]>;
  peerDetail(peerId: string): Promise<PeerDetail | null>;
}

export function createPeerService(deps: PeerServiceDeps): PeerService {
  const sizeDeps: SizeDeps = {
    getCached: deps.pinSize.get,
    setCached: deps.pinSize.set,
    uploadSize: deps.pinSize.uploadSize,
    ipfsApiUrl: deps.ipfsApiUrl,
    fetchImpl: deps.fetchImpl,
  };

  async function gather(): Promise<PeerViewInput> {
    const [peers, pins, statuses, participants] = await Promise.all([
      deps.cluster.peers(),
      deps.cluster.pins(),
      deps.cluster.pinStatuses(),
      deps.readParticipants(),
    ]);
    const sizeByCid = await resolveSizes(
      pins.map((p) => p.cid),
      sizeDeps,
    );

    // Resolve geo for each distinct public IP (best-effort).
    const ips = [
      ...new Set(
        peers
          .map((p) => extractPublicIp(p.addresses))
          .filter((ip): ip is string => !!ip),
      ),
    ];
    const geoByIp = new Map<string, Geo>();
    await Promise.all(
      ips.map(async (ip) => {
        const geo = await resolveGeo(ip, {
          getCached: deps.geo.get,
          setCached: deps.geo.set,
          fetchImpl: deps.fetchImpl,
        });
        if (geo) geoByIp.set(ip, geo);
      }),
    );

    return { peers, pins, statuses, sizeByCid, geoByIp, participants };
  }

  return {
    async enrichedPeers() {
      return buildEnrichedPeers(await gather());
    },
    async peerDetail(peerId: string) {
      const input = await gather();
      if (!input.peers.some((p) => p.id === peerId)) return null;
      const snapshots = await deps.readSnapshots(peerId);
      return buildPeerDetail(peerId, input, snapshots);
    },
  };
}
