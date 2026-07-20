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
  /** Pin metadata; tagged pins carry their tags under the `tags` key. */
  metadata: Record<string, string>;
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

export interface PinProgress {
  total: number;
  pinned: number;
  pinning: number;
  queued: number;
  error: number;
  other: number;
}

/** Live migration/pin progress across the pinset. */
export function getPinProgress(): Promise<PinProgress> {
  return gatewayFetch<PinProgress>("/pin-progress");
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
  tags: string[] = [],
): Promise<{ cid: string; name: string; size: number; tags: string[] }> {
  const form = new FormData();
  form.append("file", file, file.name);
  if (tags.length > 0) form.append("tags", tags.join(","));
  const res = await fetch(`${HONO_URL}/ingest`, {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Ingest failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<{
    cid: string;
    name: string;
    size: number;
    tags: string[];
  }>;
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
  /** Tag subscriptions (known participants only; empty = base pinset only). */
  subscribedTags: string[];
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  /** ISO timestamp of when the current online session began (online peers). */
  onlineSince: string | null;
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

export interface EnrichedPeersResult {
  peers: EnrichedPeer[];
  /** ISO timestamp of the newest geo lookup across the shown peers, or null. */
  locationsUpdatedAt: string | null;
}

/** `refresh: true` forces a fresh geo lookup server-side, bypassing the cache. */
export function getEnrichedPeers(
  opts: { refresh?: boolean } = {},
): Promise<EnrichedPeersResult> {
  return gatewayFetch<EnrichedPeersResult>(
    opts.refresh ? "/peers/enriched?refresh=1" : "/peers/enriched",
  );
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

// ----- Folders (MFS + IPNS) ------------------------------------------------

export interface FolderSummary {
  name: string;
  rootCid: string;
  /** Permanent /ipns/ name (base36 key id), or null if the key is missing. */
  ipnsName: string | null;
  size: number;
  tags: string[];
}

export interface FolderEntry {
  name: string;
  type: "file" | "dir";
  size: number;
  cid: string;
}

export interface FolderDetail extends FolderSummary {
  path: string;
  entries: FolderEntry[];
}

async function gatewayMutate<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${HONO_URL}/cluster${path}`, {
    ...init,
    headers: {
      "x-internal-token": INTERNAL_TOKEN,
      "content-type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export function getFolders(): Promise<FolderSummary[]> {
  return gatewayFetch<FolderSummary[]>("/folders");
}

export async function getFolder(
  name: string,
  path = "",
): Promise<FolderDetail | null> {
  const qs = path ? `?path=${encodeURIComponent(path)}` : "";
  const res = await fetch(
    `${HONO_URL}/cluster/folders/${encodeURIComponent(name)}${qs}`,
    { headers: { "x-internal-token": INTERNAL_TOKEN }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API /folders/${name} failed: ${res.status}`);
  return res.json() as Promise<FolderDetail>;
}

export function createFolder(
  name: string,
  tags: string[],
): Promise<FolderSummary> {
  return gatewayMutate<FolderSummary>("/folders", {
    method: "POST",
    body: JSON.stringify({ name, tags }),
  });
}

export async function deleteFolder(name: string): Promise<void> {
  await gatewayMutate(`/folders/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

export async function deleteFolderPath(
  name: string,
  path: string,
): Promise<void> {
  await gatewayMutate(
    `/folders/${encodeURIComponent(name)}/files?path=${encodeURIComponent(path)}`,
    { method: "DELETE" },
  );
}

/** Create-or-reuse a folder through the machine (API-key) ingest path. */
export async function ingestCreateFolder(
  apiKey: string,
  name: string,
  tags: string[],
): Promise<void> {
  const res = await fetch(`${HONO_URL}/folders`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ name, tags }),
  });
  if (!res.ok) {
    throw new Error(`Folder create failed: ${res.status} ${await res.text()}`);
  }
}

/**
 * Set an existing folder's tags through the machine (API-key) ingest path.
 * Used so a folder-mode upload's tags field applies even when the folder
 * already exists — `create()` on the service is non-destructive and skips
 * re-pinning (so it never silently applies typed tags) for an existing
 * folder, so uploads must call this explicitly.
 */
export async function ingestSetFolderTags(
  apiKey: string,
  name: string,
  tags: string[],
): Promise<void> {
  const res = await fetch(`${HONO_URL}/folders/${encodeURIComponent(name)}`, {
    method: "PATCH",
    headers: { "x-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ tags }),
  });
  if (!res.ok) {
    throw new Error(
      `Folder tag update failed: ${res.status} ${await res.text()}`,
    );
  }
}

/**
 * Upload one file into a folder through the API-key path. Chunked-batch
 * protocol: callers pass commit=false for all but the final file so the
 * whole batch lands as one folder version (one pin + one IPNS publish).
 */
export async function ingestFolderFile(
  apiKey: string,
  folder: string,
  file: File,
  path: string,
  commit: boolean,
): Promise<{ rootCid: string | null }> {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("path", path);
  const res = await fetch(
    `${HONO_URL}/folders/${encodeURIComponent(folder)}/files?commit=${commit}`,
    { method: "POST", headers: { "x-api-key": apiKey }, body: form },
  );
  if (!res.ok) {
    throw new Error(`Folder upload failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { rootCid: string | null };
  return { rootCid: body.rootCid };
}

/**
 * Upload one file into a folder through the internal (session-gated BFF)
 * mount — no API key. Multipart, so it gets its own fetch: gatewayMutate
 * assumes JSON bodies. Chunked-batch protocol: callers pass commit=false
 * for all but the final file so the batch lands as one folder version.
 */
export async function uploadFolderFileInternal(
  name: string,
  file: File,
  path: string,
  commit: boolean,
): Promise<{ rootCid: string | null }> {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("path", path);
  const res = await fetch(
    `${HONO_URL}/cluster/folders/${encodeURIComponent(name)}/files?commit=${commit}`,
    {
      method: "POST",
      headers: { "x-internal-token": INTERNAL_TOKEN },
      body: form,
      cache: "no-store",
    },
  );
  if (!res.ok) {
    throw new Error(`Folder upload failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { rootCid: string | null };
  return { rootCid: body.rootCid };
}

/** Mount existing CIDs into a folder via the internal mount. */
export function addFolderCids(
  name: string,
  entries: { cid: string; path: string }[],
): Promise<{ rootCid: string }> {
  return gatewayMutate<{ rootCid: string }>(
    `/folders/${encodeURIComponent(name)}/cids`,
    { method: "POST", body: JSON.stringify({ entries }) },
  );
}
