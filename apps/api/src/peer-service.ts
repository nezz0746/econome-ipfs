import type { ClusterClient, ClusterPeer } from "./cluster-client";
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

/** Cap on concurrent geo lookups so a large cluster can't burst ip-api's 45/min. */
const GEO_LOOKUP_CONCURRENCY = 8;

async function forEachLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += limit) {
    await Promise.all(items.slice(i, i + limit).map(fn));
  }
}

/** Distinct, non-relay public IPs across the given peers. */
function publicIpsOf(peers: ClusterPeer[]): string[] {
  return [
    ...new Set(
      peers
        .map((p) => extractPublicIp(p.addresses))
        .filter((ip): ip is string => !!ip),
    ),
  ];
}

export interface EnrichedPeersResult {
  peers: EnrichedPeer[];
  /** Newest geo-resolution time across the shown peers (null if none resolved). */
  locationsUpdatedAt: Date | null;
}

export interface PeerServiceDeps {
  cluster: ClusterClient;
  ipfsApiUrl: string;
  geo: {
    get(ip: string): Promise<Geo | null>;
    set(geo: Geo): Promise<void>;
    latestFetchedAt(ips: string[]): Promise<Date | null>;
  };
  pinSize: {
    get(cid: string): Promise<number | null>;
    set(cid: string, size: number, source: "upload" | "kubo"): Promise<void>;
    uploadSize(cid: string): Promise<number | null>;
  };
  readParticipants(): Promise<ParticipantRow[]>;
  readSnapshots(peerId: string): Promise<SnapshotRow[]>;
  /** Latest snapshot per peer — last-known holdings for offline peers. */
  readLastSnapshots(): Promise<
    { peerId: string; bytesHeld: number; cidCount: number }[]
  >;
  /** Newest offline snapshot per peer — start of the current online session. */
  readLastOffline(): Promise<{ peerId: string; lastOffline: Date }[]>;
  fetchImpl?: typeof fetch;
}

export interface PeerService {
  enrichedPeers(opts?: { force?: boolean }): Promise<EnrichedPeersResult>;
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

  async function gather(
    opts: { force?: boolean } = {},
  ): Promise<PeerViewInput> {
    const [peers, pins, statuses, participants, lastSnaps, lastOfflines] =
      await Promise.all([
        deps.cluster.peers(),
        deps.cluster.pins(),
        deps.cluster.pinStatuses(),
        deps.readParticipants(),
        deps.readLastSnapshots(),
        deps.readLastOffline(),
      ]);
    // Request path: resolve sizes from cache/uploads only. A large, freshly
    // pinned set would otherwise stall this response on thousands of Kubo
    // dag/stat calls; the background accounting job fills any gaps.
    const sizeByCid = await resolveSizes(
      pins.map((p) => p.cid),
      sizeDeps,
      {
        cachedOnly: true,
      },
    );
    const lastSnapshotByPeer = new Map(
      lastSnaps.map((s) => [
        s.peerId,
        { bytesHeld: s.bytesHeld, cidCount: s.cidCount },
      ]),
    );
    const lastOfflineByPeer = new Map(
      lastOfflines.map((o) => [o.peerId, o.lastOffline]),
    );

    // Resolve geo for each distinct public IP (best-effort, concurrency-capped).
    // `force` bypasses the geo cache to re-query the provider on demand.
    const geoByIp = new Map<string, Geo>();
    await forEachLimit(
      publicIpsOf(peers),
      GEO_LOOKUP_CONCURRENCY,
      async (ip) => {
        const geo = await resolveGeo(
          ip,
          {
            getCached: deps.geo.get,
            setCached: deps.geo.set,
            fetchImpl: deps.fetchImpl,
          },
          { force: opts.force },
        );
        if (geo) geoByIp.set(ip, geo);
      },
    );

    return {
      peers,
      pins,
      statuses,
      sizeByCid,
      geoByIp,
      participants,
      lastSnapshotByPeer,
      lastOfflineByPeer,
    };
  }

  return {
    async enrichedPeers(opts: { force?: boolean } = {}) {
      const input = await gather(opts);
      const locationsUpdatedAt = await deps.geo.latestFetchedAt(
        publicIpsOf(input.peers),
      );
      return { peers: buildEnrichedPeers(input), locationsUpdatedAt };
    },
    async peerDetail(peerId: string) {
      const input = await gather();
      if (!input.peers.some((p) => p.id === peerId)) return null;
      const snapshots = await deps.readSnapshots(peerId);
      return buildPeerDetail(peerId, input, snapshots);
    },
  };
}
