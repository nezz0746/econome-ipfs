/**
 * CID-preserving migration from an HTTP gateway into the local kubo node.
 *
 * Pinata (and most pinning services) do not advertise pinned CIDs to the IPFS
 * P2P network, so they can't be fetched by CID over bitswap/DHT — only over
 * their HTTPS gateway. To migrate while keeping the exact same CIDs, we pull the
 * DAG as a CARv1 (`?format=car`, the raw blocks) and import those blocks as-is
 * via kubo `/dag/import`. Because we import the original blocks rather than
 * re-chunking the file, the CID is reproduced byte-for-byte, including for
 * multi-block DAGs.
 */

export interface ImportResult {
  cid: string;
  ok: boolean;
  error?: string;
  blocks?: number;
  bytes?: number;
  /** True when dag/import errored on its response but the DAG was in fact written. */
  recovered?: boolean;
}

export interface ImportDeps {
  /** HTTP gateway base that can serve `?format=car`, e.g. https://gateway.pinata.cloud */
  gateway: string;
  /** kubo HTTP API base, e.g. http://kubo:5001 */
  ipfsApiUrl: string;
  fetchImpl?: typeof fetch;
}

/**
 * Cumulative DAG size for a CID via kubo `dag/stat`, or null if it can't be
 * resolved within `timeoutMs`. When the DAG is already local this returns fast;
 * when blocks are missing kubo would fetch over the network, so the timeout
 * doubles as a "not local" signal.
 */
async function localDagSize(
  cid: string,
  api: string,
  fetchImpl: typeof fetch,
  timeoutMs = 10000,
): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(
      `${api}/api/v0/dag/stat?arg=${encodeURIComponent(cid)}&progress=false`,
      { method: "POST", signal: controller.signal },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, unknown>;
    const size = Number(body.Size ?? body.size);
    return Number.isFinite(size) ? size : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function importCidFromGateway(
  cid: string,
  deps: ImportDeps,
): Promise<ImportResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const gw = deps.gateway.replace(/\/$/, "");
  const api = deps.ipfsApiUrl.replace(/\/$/, "");

  // 1. Fetch the whole DAG as a CAR (raw blocks) from the gateway.
  let carRes: Response;
  try {
    carRes = await fetchImpl(`${gw}/ipfs/${cid}?format=car`, {
      headers: { Accept: "application/vnd.ipld.car" },
    });
  } catch {
    return { cid, ok: false, error: "gateway_fetch_error" };
  }
  if (!carRes.ok) {
    return { cid, ok: false, error: `gateway_${carRes.status}` };
  }
  const carBytes = new Uint8Array(await carRes.arrayBuffer());
  if (carBytes.byteLength === 0) {
    return { cid, ok: false, error: "empty_car" };
  }

  // 2. Import the blocks into kubo, pinning the root(s). Byte-exact — no
  //    re-chunking — so the CID is preserved.
  const form = new FormData();
  form.append(
    "file",
    new Blob([carBytes], { type: "application/vnd.ipld.car" }),
    `${cid}.car`,
  );
  let impRes: Response;
  try {
    impRes = await fetchImpl(
      `${api}/api/v0/dag/import?pin-roots=true&stats=true`,
      { method: "POST", body: form },
    );
  } catch {
    return { cid, ok: false, error: "import_error" };
  }
  if (!impRes.ok) {
    const detail = await impRes.text().catch(() => "");
    // dag/import can return an error *after* the blocks were written (the pin or
    // response step fails), leaving the DAG actually local. Verify before
    // reporting failure: if dag/stat resolves the DAG, the import succeeded.
    const recoveredSize = await localDagSize(cid, api, fetchImpl);
    if (recoveredSize != null) {
      return { cid, ok: true, bytes: recoveredSize, recovered: true };
    }
    return {
      cid,
      ok: false,
      error: `import_${impRes.status}: ${detail.slice(0, 300)}`,
    };
  }

  // 3. Parse kubo's ndjson response; confirm an imported root equals `cid`.
  const roots: string[] = [];
  let blocks: number | undefined;
  let bytes: number | undefined;
  for (const line of (await impRes.text()).split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(t) as Record<string, unknown>;
    } catch {
      continue;
    }
    const root = obj.Root as
      | { Cid?: { "/"?: string }; PinErrorMsg?: string }
      | undefined;
    const rootCid = root?.Cid?.["/"];
    if (typeof rootCid === "string") {
      roots.push(rootCid);
      if (root?.PinErrorMsg) {
        return { cid, ok: false, error: `pin_error: ${root.PinErrorMsg}` };
      }
    }
    const stats = obj.Stats as
      | { BlockCount?: number; BlockBytesCount?: number }
      | undefined;
    if (stats) {
      blocks = Number(stats.BlockCount ?? 0);
      bytes = Number(stats.BlockBytesCount ?? 0);
    }
  }

  if (!roots.includes(cid)) {
    return {
      cid,
      ok: false,
      error: `cid_mismatch (imported ${roots.join(",") || "none"})`,
    };
  }
  return { cid, ok: true, blocks, bytes };
}
