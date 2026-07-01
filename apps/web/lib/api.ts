import "server-only";

/**
 * Server-only client for the Hono API. The browser never calls Hono directly;
 * every dashboard read/write goes through Next server code, which attaches the
 * shared internal service token here.
 */

const HONO_URL = process.env.HONO_URL ?? "http://localhost:8080";
// Must match the API's INTERNAL_TOKEN; both default to the same dev value.
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? "dev-internal-token";

export interface ClusterOverview {
  peerCount: number;
  onlinePeers: number;
  totalPins: number;
  underReplicated: number;
}

export interface Peer {
  id: string;
  peername: string;
  addresses: string[];
  ipfsId?: string;
  version?: string;
  error?: string;
}

export interface Pin {
  cid: string;
  name: string;
  allocations: string[];
  replicationFactorMin: number;
  replicationFactorMax: number;
}

async function gatewayFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${HONO_URL}/cluster${path}`, {
    headers: { "x-internal-token": INTERNAL_TOKEN },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function getOverview(): Promise<ClusterOverview> {
  return gatewayFetch<ClusterOverview>("/overview");
}

export function getPeers(): Promise<Peer[]> {
  return gatewayFetch<Peer[]>("/peers");
}

export function getPins(): Promise<Pin[]> {
  return gatewayFetch<Pin[]>("/pins");
}

/** Forward a test upload from the dashboard to the API ingest endpoint. */
export async function ingest(
  apiKey: string,
  file: File,
): Promise<{ cid: string; name: string; size: number }> {
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch(`${HONO_URL}/ingest`, {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Ingest failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<{ cid: string; name: string; size: number }>;
}

export interface Geo {
  ip: string;
  countryCode: string;
  country: string;
  city: string;
  lat: number;
  lon: number;
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
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

export interface PeerFile {
  cid: string;
  name: string;
  size: number | null;
  syncedAt: string | null;
  status: string;
}

export interface PeerSnapshot {
  capturedAt: string;
  bytesHeld: number;
  cidCount: number;
  online: boolean;
}

export interface PeerDetail extends EnrichedPeer {
  addresses: string[];
  files: PeerFile[];
  snapshots: PeerSnapshot[];
}

export function getEnrichedPeers(): Promise<EnrichedPeer[]> {
  return gatewayFetch<EnrichedPeer[]>("/peers/enriched");
}

export async function getPeerDetail(
  peerId: string,
): Promise<PeerDetail | null> {
  const res = await fetch(
    `${HONO_URL}/cluster/peers/${encodeURIComponent(peerId)}`,
    {
      headers: { "x-internal-token": INTERNAL_TOKEN },
      cache: "no-store",
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API /peers/${peerId} failed: ${res.status}`);
  return res.json() as Promise<PeerDetail>;
}
