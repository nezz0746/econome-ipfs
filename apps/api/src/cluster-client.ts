/**
 * Thin typed wrapper over the IPFS Cluster REST API (default port 9094).
 * Responsibility: request shaping + response parsing only. No business logic.
 * See https://ipfscluster.io/documentation/reference/api/
 */

export interface AddResult {
  name: string;
  cid: string;
  size: number;
}

export interface ClusterPeer {
  id: string;
  peername: string;
  addresses: string[];
  /** Underlying IPFS (Kubo) daemon id, if reachable. */
  ipfsId?: string;
  version?: string;
  /** Present when the cluster could not reach this peer. */
  error?: string;
}

export interface PinInfo {
  cid: string;
  name: string;
  allocations: string[];
  replicationFactorMin: number;
  replicationFactorMax: number;
}

export interface HealthGraph {
  clusterId: string;
  clusterPeers: string[];
  /** peerId -> list of peerIds it is connected to within the cluster. */
  clusterLinks: Record<string, string[]>;
  /** peerId -> its connected IPFS daemon peer ids. */
  ipfsLinks: Record<string, string[]>;
}

export interface Metric {
  name: string;
  peer: string;
  value: string;
  expire: string;
  valid: boolean;
}

export interface PinStatus {
  cid: string;
  /** peerId -> its status + last status-change timestamp for this CID. */
  peers: Record<string, { status: string; timestamp: string }>;
}

/** Normalize a cluster CID field which may be a string or `{ "/": "<cid>" }`. */
function normalizeCid(cid: unknown): string {
  if (typeof cid === "string") return cid;
  if (cid && typeof cid === "object" && "/" in cid) {
    return String((cid as Record<string, unknown>)["/"]);
  }
  return "";
}

/** Parse newline-delimited JSON (cluster streams arrays as ndjson). */
function parseNdjson<T = unknown>(text: string): T[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

/**
 * The cluster /add endpoint returns a JSON array when `stream-channels=false`,
 * a single JSON object, or newline-delimited objects when streaming. Normalize
 * all three into a list of added objects.
 */
function parseAddObjects(text: string): Record<string, unknown>[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return parseNdjson<Record<string, unknown>>(trimmed);
  }
}

export class ClusterClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async getText(path: string): Promise<string> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`);
    if (!res.ok) {
      throw new Error(
        `Cluster ${path} failed: ${res.status} ${res.statusText}`,
      );
    }
    return res.text();
  }

  /** Add + pin content across the cluster. Returns the (root) added object. */
  async add(
    form: FormData,
    opts: { replicationMin?: number; replicationMax?: number } = {},
  ): Promise<AddResult> {
    const params = new URLSearchParams({ "stream-channels": "false" });
    if (opts.replicationMin !== undefined)
      params.set("replication-min", String(opts.replicationMin));
    if (opts.replicationMax !== undefined)
      params.set("replication-max", String(opts.replicationMax));

    const res = await this.fetchImpl(`${this.baseUrl}/add?${params}`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      throw new Error(`Cluster /add failed: ${res.status} ${res.statusText}`);
    }
    const objects = parseAddObjects(await res.text());
    const last = objects[objects.length - 1];
    if (!last) {
      throw new Error("Cluster /add returned no objects");
    }
    return {
      name: String(last.name ?? ""),
      cid: normalizeCid(last.cid),
      size: Number(last.size ?? 0),
    };
  }

  /**
   * Pin an existing CID across the cluster (POST /pins/{cid}). The cluster
   * fetches the content over the IPFS network and replicates it per the
   * replication factor. Preserves the CID — used to migrate a pinset off
   * another pinning service without re-hashing.
   */
  async pinByCid(
    cid: string,
    opts: { replicationMin?: number; replicationMax?: number } = {},
  ): Promise<void> {
    const params = new URLSearchParams();
    if (opts.replicationMin !== undefined)
      params.set("replication-min", String(opts.replicationMin));
    if (opts.replicationMax !== undefined)
      params.set("replication-max", String(opts.replicationMax));
    const qs = params.toString();

    const res = await this.fetchImpl(
      `${this.baseUrl}/pins/${cid}${qs ? `?${qs}` : ""}`,
      { method: "POST" },
    );
    if (!res.ok) {
      throw new Error(
        `Cluster pin ${cid} failed: ${res.status} ${res.statusText}`,
      );
    }
  }

  /** Unpin a CID from the cluster (DELETE /pins/{cid}). */
  async unpin(cid: string): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/pins/${cid}`, {
      method: "DELETE",
    });
    // 404 means it wasn't pinned — treat as already-removed (idempotent).
    if (!res.ok && res.status !== 404) {
      throw new Error(
        `Cluster unpin ${cid} failed: ${res.status} ${res.statusText}`,
      );
    }
  }

  async peers(): Promise<ClusterPeer[]> {
    const raw = parseNdjson<Record<string, any>>(await this.getText("/peers"));
    return raw.map((p) => ({
      id: String(p.id),
      peername: String(p.peername ?? ""),
      addresses: Array.isArray(p.addresses) ? p.addresses.map(String) : [],
      ipfsId: p.ipfs?.id ? String(p.ipfs.id) : undefined,
      version: p.version ? String(p.version) : undefined,
      error: p.error ? String(p.error) : undefined,
    }));
  }

  async pins(): Promise<PinInfo[]> {
    const raw = parseNdjson<Record<string, any>>(await this.getText("/pins"));
    return raw.map((p) => ({
      cid: normalizeCid(p.cid),
      name: String(p.name ?? ""),
      allocations: Array.isArray(p.allocations)
        ? p.allocations.map(String)
        : [],
      replicationFactorMin: Number(p.replication_factor_min ?? -1),
      replicationFactorMax: Number(p.replication_factor_max ?? -1),
    }));
  }

  /**
   * Per-CID, per-peer pin status. Uses the cluster status stream (/pins), whose
   * GlobalPinInfo objects carry a peer_map of {status, timestamp}. Used to show
   * which files a peer holds and when each finished pinning.
   */
  async pinStatuses(): Promise<PinStatus[]> {
    const raw = parseNdjson<Record<string, any>>(await this.getText("/pins"));
    return raw.map((p) => {
      const peerMap = (p.peer_map ?? {}) as Record<string, any>;
      const peers: PinStatus["peers"] = {};
      for (const [peerId, info] of Object.entries(peerMap)) {
        peers[peerId] = {
          status: String(info?.status ?? "unknown"),
          timestamp: String(info?.timestamp ?? ""),
        };
      }
      return { cid: normalizeCid(p.cid), peers };
    });
  }

  async healthGraph(): Promise<HealthGraph> {
    const raw = JSON.parse(await this.getText("/health/graph")) as Record<
      string,
      any
    >;
    return {
      clusterId: String(raw.cluster_id ?? ""),
      clusterPeers: Array.isArray(raw.cluster_peers)
        ? raw.cluster_peers.map(String)
        : [],
      clusterLinks: (raw.cluster_links ?? {}) as Record<string, string[]>,
      ipfsLinks: (raw.ipfs_links ?? {}) as Record<string, string[]>,
    };
  }

  /** Metrics by name, e.g. "freespace" or "ping". */
  async metrics(name: string): Promise<Metric[]> {
    const raw = JSON.parse(
      await this.getText(`/monitor/metrics/${name}`),
    ) as Record<string, any>[];
    return raw.map((m) => ({
      name: String(m.name ?? name),
      peer: String(m.peer ?? ""),
      value: String(m.value ?? ""),
      expire: String(m.expire ?? ""),
      valid: Boolean(m.valid),
    }));
  }
}
