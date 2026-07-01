# Peer Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the dashboard's flat peer table into a rich operator view showing each peer's synced files (with sync times), public IP + geo-location, real bytes held, and a contribution chart over time.

**Architecture:** All cluster/Kubo/GeoIP calls stay server-side in the Hono API (`apps/api`); the Next app reads via its existing internal-token BFF (`apps/web/lib/api.ts`). Volatile data (pins, statuses, addresses) is read live; only immutable pin sizes and slow-changing geoIP are cached in two new Postgres tables. The periodic accounting job reuses the size cache to persist real `bytesHeld`.

**Tech Stack:** TypeScript, Hono, Drizzle ORM + Postgres, Next.js (App Router, server components), Vitest, shadcn/ui. No new runtime dependency — the contribution chart is a hand-rolled SVG (pure geometry function, unit-tested).

## Global Constraints

- The web app NEVER calls the cluster directly — every dashboard read goes through `apps/web/lib/api.ts` → Hono `/cluster/*` (internal-token gated). Copy this boundary.
- Env vars follow the existing `requireInProd(name, devValue)` / `?? devFallback` pattern in `apps/api/src/config.ts` — production-required, dev-fallback. Never throw at import time.
- Best-effort enrichment: a failed geo or size lookup renders "—" and never fails the whole page (mirrors the register/status best-effort pattern).
- New pure functions get Vitest unit tests with mocked `fetch` (pattern: `apps/api/test/cluster-client.test.ts`). No network in tests.
- Package manager is `pnpm` (v9); run filtered scripts, e.g. `pnpm --filter @repo/api test`.
- Node engine floor `>=18`. Use built-in `fetch` (already used by ClusterClient).
- Commit after every task with a `feat:`/`test:`/`chore:` message.

---

## File Structure

**Create:**
- `apps/api/src/net.ts` — pure `extractPublicIp(addresses)`.
- `apps/api/src/geoip.ts` — `resolveGeo(ip, deps)` (cache + ip-api.com).
- `apps/api/src/pin-size.ts` — `resolveSize`/`resolveSizes` (uploads.size → Kubo `dag/stat` → cache).
- `apps/api/src/peer-view.ts` — pure assembly: `buildEnrichedPeers`, `buildPeerDetail`.
- `apps/api/src/peer-service.ts` — glue: wires cluster + geo + size + db into `enrichedPeers()`/`peerDetail(id)`.
- `apps/api/test/net.test.ts`, `geoip.test.ts`, `pin-size.test.ts`, `peer-view.test.ts`.
- `apps/web/app/dashboard/peers/[peerId]/page.tsx` — peer detail page.
- `apps/web/lib/chart.ts` — pure `buildAreaPath(values, width, height)`.
- `apps/web/components/contribution-chart.tsx` — SVG chart component.
- `apps/web/lib/chart.test.ts`.

**Modify:**
- `packages/db/src/schema.ts` — add `geoipCache`, `pinSizes` tables + inferred types.
- `apps/api/src/cluster-client.ts` — add `pinStatuses()` + `PinStatus` type.
- `apps/api/src/accounting.ts` — `buildSnapshots` takes a `sizeByCid` map; `runAccountingJob` resolves sizes.
- `apps/api/test/accounting.test.ts` — update for the new signature.
- `apps/api/src/config.ts` — add `ipfsApiUrl`.
- `apps/api/src/app.ts` — add `peerService` dep + two gateway routes.
- `apps/api/test/app.test.ts` — cover the two new routes with a stub service.
- `apps/api/src/index.ts` — construct `peerService` + db-backed deps.
- `apps/web/lib/api.ts` — `getEnrichedPeers()`, `getPeerDetail(id)` + types.
- `apps/web/app/dashboard/peers/page.tsx` — enriched columns + row links.

---

## Task 1: DB schema — geoip_cache + pin_sizes tables

**Files:**
- Modify: `packages/db/src/schema.ts` (add tables near `contributionSnapshots`, ~line 148; add inferred types at the type block, ~line 196)
- Create (generated): `packages/db/drizzle/0002_*.sql`

**Interfaces:**
- Produces: tables `geoipCache`, `pinSizes`; types `GeoipCacheRow`, `NewGeoipCacheRow`, `PinSizeRow`, `NewPinSizeRow`.

- [ ] **Step 1: Add the two tables**

In `packages/db/src/schema.ts`, immediately after the `contributionSnapshots` table definition, add. Ensure `doublePrecision` and `integer`/`bigint` are in the existing `drizzle-orm/pg-core` import at the top (add `doublePrecision` if missing):

```ts
/** Cache of IP -> geo lookups (ip-api.com). One row per IP, refreshed by TTL. */
export const geoipCache = pgTable("geoip_cache", {
  ip: text("ip").primaryKey(),
  countryCode: text("country_code"),
  country: text("country"),
  city: text("city"),
  lat: doublePrecision("lat"),
  lon: doublePrecision("lon"),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
});

/** Cache of CID -> byte size. A CID's size is immutable, so this never expires. */
export const pinSizes = pgTable("pin_sizes", {
  cid: text("cid").primaryKey(),
  size: bigint("size", { mode: "number" }).notNull(),
  source: text("source").notNull(), // 'upload' | 'kubo'
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
});
```

- [ ] **Step 2: Add inferred types**

At the end of `packages/db/src/schema.ts` (after `NewContributionSnapshot`):

```ts
export type GeoipCacheRow = typeof geoipCache.$inferSelect;
export type NewGeoipCacheRow = typeof geoipCache.$inferInsert;
export type PinSizeRow = typeof pinSizes.$inferSelect;
export type NewPinSizeRow = typeof pinSizes.$inferInsert;
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm --filter @repo/db db:generate`
Expected: a new file `packages/db/drizzle/0002_*.sql` containing `CREATE TABLE "geoip_cache"` and `CREATE TABLE "pin_sizes"`.

- [ ] **Step 4: Type-check**

Run: `pnpm --filter @repo/db check-types`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle
git commit -m "feat(db): add geoip_cache and pin_sizes tables"
```

---

## Task 2: extractPublicIp pure function

**Files:**
- Create: `apps/api/src/net.ts`
- Test: `apps/api/test/net.test.ts`

**Interfaces:**
- Produces: `extractPublicIp(addresses: string[]): string | null`

- [ ] **Step 1: Write the failing test**

`apps/api/test/net.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractPublicIp } from "../src/net";

describe("extractPublicIp", () => {
  it("returns the first public IPv4, skipping loopback and private ranges", () => {
    const addrs = [
      "/ip4/127.0.0.1/tcp/9096",
      "/ip4/172.22.0.4/tcp/9096",
      "/ip4/10.0.1.146/tcp/4001",
      "/ip4/51.83.32.120/tcp/4001",
    ];
    expect(extractPublicIp(addrs)).toBe("51.83.32.120");
  });

  it("falls back to a public IPv6 when no public IPv4 exists", () => {
    expect(extractPublicIp(["/ip6/::1/tcp/4001", "/ip6/2a01:cb00::1/tcp/4001"])).toBe(
      "2a01:cb00::1",
    );
  });

  it("returns null when only private/loopback addresses exist", () => {
    expect(extractPublicIp(["/ip4/192.168.1.5/tcp/4001", "/ip4/127.0.0.1/tcp/4001"])).toBe(
      null,
    );
  });

  it("returns null for empty input", () => {
    expect(extractPublicIp([])).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/api test -- net`
Expected: FAIL — cannot find module `../src/net`.

- [ ] **Step 3: Implement**

`apps/api/src/net.ts`:

```ts
/** Extract a peer's first public IP from its libp2p multiaddrs. */
export function extractPublicIp(addresses: string[]): string | null {
  const ip4: string[] = [];
  const ip6: string[] = [];
  for (const addr of addresses) {
    const parts = addr.split("/");
    const i4 = parts.indexOf("ip4");
    if (i4 >= 0 && parts[i4 + 1]) ip4.push(parts[i4 + 1]);
    const i6 = parts.indexOf("ip6");
    if (i6 >= 0 && parts[i6 + 1]) ip6.push(parts[i6 + 1]);
  }
  const publicV4 = ip4.find((ip) => !isPrivateV4(ip));
  if (publicV4) return publicV4;
  const publicV6 = ip6.find((ip) => !isPrivateV6(ip));
  return publicV6 ?? null;
}

function isPrivateV4(ip: string): boolean {
  const o = ip.split(".").map(Number);
  if (o.length !== 4 || o.some((n) => Number.isNaN(n))) return true;
  if (o[0] === 10) return true; // 10.0.0.0/8
  if (o[0] === 127) return true; // loopback
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true; // 172.16/12
  if (o[0] === 192 && o[1] === 168) return true; // 192.168/16
  if (o[0] === 169 && o[1] === 254) return true; // link-local
  if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true; // CGNAT
  return false;
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repo/api test -- net`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/net.ts apps/api/test/net.test.ts
git commit -m "feat(api): extract public IP from peer multiaddrs"
```

---

## Task 3: ClusterClient.pinStatuses()

**Files:**
- Modify: `apps/api/src/cluster-client.ts` (add type + method after `pins()`, ~line 167)
- Test: `apps/api/test/cluster-client.test.ts` (append a test)

**Interfaces:**
- Consumes: existing `ClusterClient(baseUrl, fetchImpl)`, private `getText`, `parseNdjson`, `normalizeCid`.
- Produces: `PinStatus = { cid: string; peers: Record<string, { status: string; timestamp: string }> }`; method `pinStatuses(): Promise<PinStatus[]>`.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/cluster-client.test.ts`:

```ts
it("parses /pins global status into per-peer status + timestamp", async () => {
  const fetchImpl = mockFetch({
    "/pins": {
      body:
        JSON.stringify({
          cid: { "/": "bafyc1" },
          peer_map: {
            "peer-a": { status: "pinned", timestamp: "2026-06-30T10:00:00Z" },
            "peer-b": { status: "pinning", timestamp: "2026-06-30T10:05:00Z" },
          },
        }) + "\n",
    },
  });
  const client = new ClusterClient("http://cluster:9094", fetchImpl);

  const statuses = await client.pinStatuses();

  expect(statuses).toHaveLength(1);
  expect(statuses[0].cid).toBe("bafyc1");
  expect(statuses[0].peers["peer-a"]).toEqual({
    status: "pinned",
    timestamp: "2026-06-30T10:00:00Z",
  });
  expect(statuses[0].peers["peer-b"].status).toBe("pinning");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/api test -- cluster-client`
Expected: FAIL — `client.pinStatuses is not a function`.

- [ ] **Step 3: Implement**

In `apps/api/src/cluster-client.ts`, add the type near the other interfaces (after `Metric`, ~line 47):

```ts
export interface PinStatus {
  cid: string;
  /** peerId -> its status + last status-change timestamp for this CID. */
  peers: Record<string, { status: string; timestamp: string }>;
}
```

And add the method inside the `ClusterClient` class after `pins()`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repo/api test -- cluster-client`
Expected: PASS (all cluster-client tests, including the new one).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/cluster-client.ts apps/api/test/cluster-client.test.ts
git commit -m "feat(api): add ClusterClient.pinStatuses for per-peer sync times"
```

---

## Task 4: GeoIP resolver

**Files:**
- Create: `apps/api/src/geoip.ts`
- Test: `apps/api/test/geoip.test.ts`

**Interfaces:**
- Produces:
  - `interface Geo { ip: string; countryCode: string; country: string; city: string; lat: number; lon: number }`
  - `interface GeoDeps { getCached(ip: string): Promise<Geo | null>; setCached(geo: Geo): Promise<void>; fetchImpl?: typeof fetch }`
  - `resolveGeo(ip: string, deps: GeoDeps): Promise<Geo | null>`

- [ ] **Step 1: Write the failing test**

`apps/api/test/geoip.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { resolveGeo } from "../src/geoip";

const sample = {
  status: "success",
  countryCode: "FR",
  country: "France",
  city: "Roubaix",
  lat: 50.6942,
  lon: 3.1746,
};

describe("resolveGeo", () => {
  it("returns cached geo without calling the network", async () => {
    const fetchImpl = vi.fn();
    const cached = { ip: "1.2.3.4", countryCode: "FR", country: "France", city: "Roubaix", lat: 50.69, lon: 3.17 };
    const geo = await resolveGeo("1.2.3.4", {
      getCached: async () => cached,
      setCached: async () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(geo).toEqual(cached);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches, caches, and returns geo on a cache miss", async () => {
    const set = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(sample))) as unknown as typeof fetch;
    const geo = await resolveGeo("1.2.3.4", {
      getCached: async () => null,
      setCached: set,
      fetchImpl,
    });
    expect(geo).toMatchObject({ ip: "1.2.3.4", countryCode: "FR", city: "Roubaix" });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ ip: "1.2.3.4", country: "France" }));
  });

  it("returns null (and does not cache) when the provider reports failure", async () => {
    const set = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: "fail" }))) as unknown as typeof fetch;
    const geo = await resolveGeo("10.0.0.1", { getCached: async () => null, setCached: set, fetchImpl });
    expect(geo).toBeNull();
    expect(set).not.toHaveBeenCalled();
  });

  it("returns null when the network throws", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("network"); }) as unknown as typeof fetch;
    const geo = await resolveGeo("1.2.3.4", { getCached: async () => null, setCached: async () => {}, fetchImpl });
    expect(geo).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/api test -- geoip`
Expected: FAIL — cannot find module `../src/geoip`.

- [ ] **Step 3: Implement**

`apps/api/src/geoip.ts`:

```ts
export interface Geo {
  ip: string;
  countryCode: string;
  country: string;
  city: string;
  lat: number;
  lon: number;
}

export interface GeoDeps {
  getCached(ip: string): Promise<Geo | null>;
  setCached(geo: Geo): Promise<void>;
  fetchImpl?: typeof fetch;
}

/**
 * Resolve an IP to a geo location. Cache-first; on a miss, queries ip-api.com
 * (free, no key) and caches the result. Best-effort: any failure returns null.
 */
export async function resolveGeo(ip: string, deps: GeoDeps): Promise<Geo | null> {
  const cached = await deps.getCached(ip);
  if (cached) return cached;

  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,city,lat,lon`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, unknown>;
    if (body.status !== "success") return null;
    const geo: Geo = {
      ip,
      countryCode: String(body.countryCode ?? ""),
      country: String(body.country ?? ""),
      city: String(body.city ?? ""),
      lat: Number(body.lat ?? 0),
      lon: Number(body.lon ?? 0),
    };
    await deps.setCached(geo);
    return geo;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repo/api test -- geoip`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/geoip.ts apps/api/test/geoip.test.ts
git commit -m "feat(api): geoIP resolver with cache-first ip-api lookup"
```

---

## Task 5: Pin size resolver

**Files:**
- Create: `apps/api/src/pin-size.ts`
- Test: `apps/api/test/pin-size.test.ts`

**Interfaces:**
- Produces:
  - `interface SizeDeps { getCached(cid: string): Promise<number | null>; setCached(cid: string, size: number, source: "upload" | "kubo"): Promise<void>; uploadSize(cid: string): Promise<number | null>; ipfsApiUrl: string; fetchImpl?: typeof fetch }`
  - `resolveSize(cid: string, deps: SizeDeps): Promise<number | null>`
  - `resolveSizes(cids: string[], deps: SizeDeps): Promise<Map<string, number>>`

- [ ] **Step 1: Write the failing test**

`apps/api/test/pin-size.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { resolveSize, resolveSizes } from "../src/pin-size";

function baseDeps(over: Partial<Parameters<typeof resolveSize>[1]> = {}) {
  return {
    getCached: async () => null,
    setCached: vi.fn(async () => {}),
    uploadSize: async () => null,
    ipfsApiUrl: "http://kubo:5001",
    fetchImpl: (async () => { throw new Error("no network expected"); }) as unknown as typeof fetch,
    ...over,
  };
}

describe("resolveSize", () => {
  it("returns cached size without touching uploads or kubo", async () => {
    const deps = baseDeps({ getCached: async () => 42 });
    expect(await resolveSize("c1", deps)).toBe(42);
    expect(deps.setCached).not.toHaveBeenCalled();
  });

  it("uses uploads.size when present and caches it as source=upload", async () => {
    const deps = baseDeps({ uploadSize: async () => 100 });
    expect(await resolveSize("c1", deps)).toBe(100);
    expect(deps.setCached).toHaveBeenCalledWith("c1", 100, "upload");
  });

  it("falls back to kubo dag/stat and caches as source=kubo", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ Size: 256 }))) as unknown as typeof fetch;
    const deps = baseDeps({ fetchImpl });
    expect(await resolveSize("c1", deps)).toBe(256);
    expect(deps.setCached).toHaveBeenCalledWith("c1", 256, "kubo");
  });

  it("returns null when kubo fails", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("down"); }) as unknown as typeof fetch;
    const deps = baseDeps({ fetchImpl });
    expect(await resolveSize("c1", deps)).toBeNull();
    expect(deps.setCached).not.toHaveBeenCalled();
  });
});

describe("resolveSizes", () => {
  it("builds a cid->size map, omitting unresolved cids", async () => {
    const deps = baseDeps({
      uploadSize: async (cid: string) => (cid === "c1" ? 10 : null),
    });
    const map = await resolveSizes(["c1", "c2"], deps);
    expect(map.get("c1")).toBe(10);
    expect(map.has("c2")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/api test -- pin-size`
Expected: FAIL — cannot find module `../src/pin-size`.

- [ ] **Step 3: Implement**

`apps/api/src/pin-size.ts`:

```ts
export interface SizeDeps {
  getCached(cid: string): Promise<number | null>;
  setCached(cid: string, size: number, source: "upload" | "kubo"): Promise<void>;
  /** Size recorded at ingest time (uploads table), if this CID came through us. */
  uploadSize(cid: string): Promise<number | null>;
  ipfsApiUrl: string;
  fetchImpl?: typeof fetch;
}

/**
 * Resolve a CID's byte size. Cache -> uploads.size -> Kubo dag/stat. A CID's
 * size is immutable, so any resolved value is cached forever. Best-effort:
 * returns null if every source fails.
 */
export async function resolveSize(cid: string, deps: SizeDeps): Promise<number | null> {
  const cached = await deps.getCached(cid);
  if (cached != null) return cached;

  const fromUpload = await deps.uploadSize(cid);
  if (fromUpload != null) {
    await deps.setCached(cid, fromUpload, "upload");
    return fromUpload;
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(
      `${deps.ipfsApiUrl.replace(/\/$/, "")}/api/v0/dag/stat?arg=${encodeURIComponent(cid)}&progress=false`,
      { method: "POST" },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, unknown>;
    const size = Number(body.Size ?? body.size);
    if (!Number.isFinite(size)) return null;
    await deps.setCached(cid, size, "kubo");
    return size;
  } catch {
    return null;
  }
}

/** Resolve many CIDs into a cid->size map, omitting any that fail to resolve. */
export async function resolveSizes(cids: string[], deps: SizeDeps): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const unique = [...new Set(cids)];
  const sizes = await Promise.all(unique.map((cid) => resolveSize(cid, deps)));
  unique.forEach((cid, i) => {
    const size = sizes[i];
    if (size != null) map.set(cid, size);
  });
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repo/api test -- pin-size`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/pin-size.ts apps/api/test/pin-size.test.ts
git commit -m "feat(api): pin size resolver (uploads -> kubo dag/stat, cached)"
```

---

## Task 6: Real bytesHeld in the accounting job

**Files:**
- Modify: `apps/api/src/accounting.ts`
- Modify: `apps/api/test/accounting.test.ts`

**Interfaces:**
- Consumes: `resolveSizes` (Task 5), `PinInfo`, `ClusterPeer`, `NewContributionSnapshot`.
- Produces: `buildSnapshots(peers, pins, sizeByCid: Map<string, number>, capturedAt): NewContributionSnapshot[]`; `AccountingDeps` gains `resolveSizes(cids: string[]): Promise<Map<string, number>>`.

- [ ] **Step 1: Update the failing test**

In `apps/api/test/accounting.test.ts`, replace the `buildSnapshots` describe block body so it passes a size map and asserts real bytes. Update the `buildSnapshots(peers, pins, at)` call to include a map, and expect non-zero `bytesHeld`:

```ts
describe("buildSnapshots", () => {
  it("counts pins per peer, sums held bytes, and flags online status", () => {
    const at = new Date("2026-06-29T00:00:00Z");
    const sizeByCid = new Map([
      ["c1", 100],
      ["c2", 50],
    ]);
    const snaps = buildSnapshots(peers, pins, sizeByCid, at);

    expect(snaps).toEqual([
      { peerId: "peer-a", bytesHeld: 150, cidCount: 2, online: true, capturedAt: at },
      { peerId: "peer-b", bytesHeld: 100, cidCount: 1, online: false, capturedAt: at },
    ]);
  });

  it("treats an unknown cid size as zero bytes", () => {
    const at = new Date("2026-06-29T00:00:00Z");
    const snaps = buildSnapshots(peers, pins, new Map([["c2", 50]]), at);
    expect(snaps[0].bytesHeld).toBe(50); // peer-a holds c1 (unknown) + c2 (50)
  });
});
```

Also update the `runAccountingJob` test in the same file to stub `resolveSizes`. Find the `runAccountingJob` describe and ensure the deps object includes:

```ts
resolveSizes: async () => new Map<string, number>([["c1", 100], ["c2", 50]]),
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/api test -- accounting`
Expected: FAIL — `buildSnapshots` expects 3 args / `bytesHeld` mismatch.

- [ ] **Step 3: Implement**

In `apps/api/src/accounting.ts`, update `buildSnapshots`:

```ts
export function buildSnapshots(
  peers: ClusterPeer[],
  pins: PinInfo[],
  sizeByCid: Map<string, number>,
  capturedAt: Date,
): NewContributionSnapshot[] {
  return peers.map((peer) => {
    const held = pins.filter((pin) => pin.allocations.includes(peer.id));
    const bytesHeld = held.reduce((sum, pin) => sum + (sizeByCid.get(pin.cid) ?? 0), 0);
    return {
      peerId: peer.id,
      bytesHeld,
      cidCount: held.length,
      online: !peer.error,
      capturedAt,
    };
  });
}
```

Update `AccountingDeps` to add:

```ts
  /** Resolve sizes for the given CIDs (populates the pin_sizes cache). */
  resolveSizes: (cids: string[]) => Promise<Map<string, number>>;
```

Update `runAccountingJob` to resolve sizes before building snapshots:

```ts
export async function runAccountingJob(deps: AccountingDeps): Promise<number> {
  const [peers, pins] = await Promise.all([deps.cluster.peers(), deps.cluster.pins()]);
  const sizeByCid = await deps.resolveSizes(pins.map((p) => p.cid));
  const capturedAt = deps.now();
  const snapshots = buildSnapshots(peers, pins, sizeByCid, capturedAt);
  await deps.saveSnapshots(snapshots, capturedAt);
  return snapshots.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repo/api test -- accounting`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/accounting.ts apps/api/test/accounting.test.ts
git commit -m "feat(api): compute real bytesHeld in accounting snapshots"
```

---

## Task 7: Peer-view assembly (pure)

**Files:**
- Create: `apps/api/src/peer-view.ts`
- Test: `apps/api/test/peer-view.test.ts`

**Interfaces:**
- Consumes: `ClusterPeer`, `PinInfo`, `PinStatus` (cluster-client); `Geo` (geoip); `extractPublicIp` (net).
- Produces:
  - `interface ParticipantRow { peerId: string; label: string | null; firstSeenAt: Date; lastSeenAt: Date }`
  - `interface SnapshotRow { capturedAt: Date; bytesHeld: number; cidCount: number; online: boolean }`
  - `interface PeerFile { cid: string; name: string; size: number | null; syncedAt: string | null; status: string }`
  - `interface EnrichedPeer { id: string; peername: string; ipfsId?: string; version?: string; online: boolean; publicIp: string | null; geo: Geo | null; bytesHeld: number; fileCount: number; firstSeenAt: Date | null; lastSeenAt: Date | null }`
  - `interface PeerDetail extends EnrichedPeer { addresses: string[]; files: PeerFile[]; snapshots: SnapshotRow[] }`
  - `interface PeerViewInput { peers: ClusterPeer[]; pins: PinInfo[]; statuses: PinStatus[]; sizeByCid: Map<string, number>; geoByIp: Map<string, Geo>; participants: ParticipantRow[] }`
  - `buildEnrichedPeers(input: PeerViewInput): EnrichedPeer[]`
  - `buildPeerDetail(peerId: string, input: PeerViewInput, snapshots: SnapshotRow[]): PeerDetail | null`

- [ ] **Step 1: Write the failing test**

`apps/api/test/peer-view.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildEnrichedPeers, buildPeerDetail, type PeerViewInput } from "../src/peer-view";

const input: PeerViewInput = {
  peers: [
    { id: "peer-a", peername: "main", addresses: ["/ip4/51.83.32.120/tcp/9096"], ipfsId: "ipfs-a", version: "1.0" },
    { id: "peer-b", peername: "follower", addresses: ["/ip4/10.0.0.2/tcp/9096"], error: "down" },
  ],
  pins: [
    { cid: "c1", name: "a.txt", allocations: ["peer-a", "peer-b"], replicationFactorMin: 2, replicationFactorMax: 2 },
    { cid: "c2", name: "b.txt", allocations: ["peer-a"], replicationFactorMin: 1, replicationFactorMax: 1 },
  ],
  statuses: [
    { cid: "c1", peers: { "peer-a": { status: "pinned", timestamp: "2026-06-30T10:00:00Z" } } },
    { cid: "c2", peers: { "peer-a": { status: "pinned", timestamp: "2026-06-30T11:00:00Z" } } },
  ],
  sizeByCid: new Map([["c1", 100], ["c2", 50]]),
  geoByIp: new Map([["51.83.32.120", { ip: "51.83.32.120", countryCode: "FR", country: "France", city: "Roubaix", lat: 50.69, lon: 3.17 }]]),
  participants: [
    { peerId: "peer-a", label: "main-node", firstSeenAt: new Date("2026-06-01"), lastSeenAt: new Date("2026-06-30") },
  ],
};

describe("buildEnrichedPeers", () => {
  it("enriches each peer with ip, geo, bytes, file count, and seen times", () => {
    const rows = buildEnrichedPeers(input);
    const a = rows.find((r) => r.id === "peer-a")!;
    expect(a).toMatchObject({ publicIp: "51.83.32.120", bytesHeld: 150, fileCount: 2, online: true });
    expect(a.geo?.city).toBe("Roubaix");
    expect(a.firstSeenAt).toEqual(new Date("2026-06-01"));
    const b = rows.find((r) => r.id === "peer-b")!;
    expect(b).toMatchObject({ publicIp: null, geo: null, online: false, fileCount: 1 });
  });
});

describe("buildPeerDetail", () => {
  it("returns files with sync times and status for the peer", () => {
    const detail = buildPeerDetail("peer-a", input, [
      { capturedAt: new Date("2026-06-30"), bytesHeld: 150, cidCount: 2, online: true },
    ])!;
    expect(detail.addresses).toContain("/ip4/51.83.32.120/tcp/9096");
    expect(detail.files).toEqual([
      { cid: "c1", name: "a.txt", size: 100, syncedAt: "2026-06-30T10:00:00Z", status: "pinned" },
      { cid: "c2", name: "b.txt", size: 50, syncedAt: "2026-06-30T11:00:00Z", status: "pinned" },
    ]);
    expect(detail.snapshots).toHaveLength(1);
  });

  it("returns null for an unknown peer", () => {
    expect(buildPeerDetail("nope", input, [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/api test -- peer-view`
Expected: FAIL — cannot find module `../src/peer-view`.

- [ ] **Step 3: Implement**

`apps/api/src/peer-view.ts`:

```ts
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
  const bytesHeld = held.reduce((sum, pin) => sum + (input.sizeByCid.get(pin.cid) ?? 0), 0);
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
  const statusByCid = new Map(input.statuses.map((s) => [s.cid, s.peers[peerId]]));
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repo/api test -- peer-view`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/peer-view.ts apps/api/test/peer-view.test.ts
git commit -m "feat(api): pure peer-view assembly for enriched list + detail"
```

---

## Task 8: Peer service (glue)

**Files:**
- Create: `apps/api/src/peer-service.ts`
- Test: `apps/api/test/peer-service.test.ts`

**Interfaces:**
- Consumes: `ClusterClient`, `resolveGeo`/`GeoDeps`, `resolveSizes`/`SizeDeps`, `buildEnrichedPeers`/`buildPeerDetail`, `ParticipantRow`/`SnapshotRow`.
- Produces:
  - `interface PeerServiceDeps { cluster: ClusterClient; ipfsApiUrl: string; geo: { get(ip: string): Promise<Geo | null>; set(geo: Geo): Promise<void> }; pinSize: { get(cid: string): Promise<number | null>; set(cid: string, size: number, source: "upload" | "kubo"): Promise<void>; uploadSize(cid: string): Promise<number | null> }; readParticipants(): Promise<ParticipantRow[]>; readSnapshots(peerId: string): Promise<SnapshotRow[]>; fetchImpl?: typeof fetch }`
  - `interface PeerService { enrichedPeers(): Promise<EnrichedPeer[]>; peerDetail(peerId: string): Promise<PeerDetail | null> }`
  - `createPeerService(deps: PeerServiceDeps): PeerService`

- [ ] **Step 1: Write the failing test**

`apps/api/test/peer-service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createPeerService } from "../src/peer-service";
import type { ClusterClient } from "../src/cluster-client";

const cluster = {
  peers: async () => [
    { id: "peer-a", peername: "main", addresses: ["/ip4/51.83.32.120/tcp/9096"], ipfsId: "ipfs-a" },
  ],
  pins: async () => [
    { cid: "c1", name: "a.txt", allocations: ["peer-a"], replicationFactorMin: 1, replicationFactorMax: 1 },
  ],
  pinStatuses: async () => [
    { cid: "c1", peers: { "peer-a": { status: "pinned", timestamp: "2026-06-30T10:00:00Z" } } },
  ],
} as unknown as ClusterClient;

function deps(over = {}) {
  return {
    cluster,
    ipfsApiUrl: "http://kubo:5001",
    geo: {
      get: async () => ({ ip: "51.83.32.120", countryCode: "FR", country: "France", city: "Roubaix", lat: 50.6, lon: 3.1 }),
      set: async () => {},
    },
    pinSize: { get: async () => 100, set: async () => {}, uploadSize: async () => null },
    readParticipants: async () => [
      { peerId: "peer-a", label: "main", firstSeenAt: new Date("2026-06-01"), lastSeenAt: new Date("2026-06-30") },
    ],
    readSnapshots: async () => [{ capturedAt: new Date("2026-06-30"), bytesHeld: 100, cidCount: 1, online: true }],
    ...over,
  };
}

describe("peerService.enrichedPeers", () => {
  it("assembles enriched peers from cluster + caches + db", async () => {
    const svc = createPeerService(deps());
    const rows = await svc.enrichedPeers();
    expect(rows[0]).toMatchObject({ id: "peer-a", publicIp: "51.83.32.120", bytesHeld: 100, fileCount: 1 });
    expect(rows[0].geo?.country).toBe("France");
  });
});

describe("peerService.peerDetail", () => {
  it("returns detail with files, sync times, and snapshots", async () => {
    const svc = createPeerService(deps());
    const detail = await svc.peerDetail("peer-a");
    expect(detail?.files[0]).toEqual({ cid: "c1", name: "a.txt", size: 100, syncedAt: "2026-06-30T10:00:00Z", status: "pinned" });
    expect(detail?.snapshots).toHaveLength(1);
  });

  it("returns null for an unknown peer", async () => {
    const svc = createPeerService(deps());
    expect(await svc.peerDetail("nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/api test -- peer-service`
Expected: FAIL — cannot find module `../src/peer-service`.

- [ ] **Step 3: Implement**

`apps/api/src/peer-service.ts`:

```ts
import type { ClusterClient } from "./cluster-client";
import type { Geo } from "./geoip";
import { resolveGeo } from "./geoip";
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
import { extractPublicIp } from "./net";

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
    const sizeByCid = await resolveSizes(pins.map((p) => p.cid), sizeDeps);

    // Resolve geo for each distinct public IP (best-effort).
    const ips = [...new Set(peers.map((p) => extractPublicIp(p.addresses)).filter((ip): ip is string => !!ip))];
    const geoByIp = new Map<string, Geo>();
    await Promise.all(
      ips.map(async (ip) => {
        const geo = await resolveGeo(ip, { getCached: deps.geo.get, setCached: deps.geo.set, fetchImpl: deps.fetchImpl });
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repo/api test -- peer-service`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/peer-service.ts apps/api/test/peer-service.test.ts
git commit -m "feat(api): peer-service wiring cluster + geo + size + db"
```

---

## Task 9: API endpoints

**Files:**
- Modify: `apps/api/src/app.ts` (add `peerService` to `AppDeps`; add two routes in the gateway)
- Modify: `apps/api/test/app.test.ts` (add route tests with a stub service)

**Interfaces:**
- Consumes: `PeerService` (Task 8).
- Produces: routes `GET /cluster/peers/enriched`, `GET /cluster/peers/:peerId`; `AppDeps.peerService: PeerService`.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/app.test.ts` (reuse the file's existing `createApp` + deps helper; if it builds deps inline, add `peerService` to that object). Add:

```ts
it("GET /cluster/peers/enriched returns enriched peers (internal token)", async () => {
  const app = createApp(makeDeps({
    peerService: {
      enrichedPeers: async () => [{ id: "peer-a", peername: "main", online: true, publicIp: "51.83.32.120", geo: null, bytesHeld: 100, fileCount: 1, firstSeenAt: null, lastSeenAt: null }],
      peerDetail: async () => null,
    },
  }));
  const res = await app.request("/cluster/peers/enriched", {
    headers: { "x-internal-token": "dev-internal-token" },
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body[0].id).toBe("peer-a");
});

it("GET /cluster/peers/:id returns 404 for an unknown peer", async () => {
  const app = createApp(makeDeps({
    peerService: { enrichedPeers: async () => [], peerDetail: async () => null },
  }));
  const res = await app.request("/cluster/peers/nope", {
    headers: { "x-internal-token": "dev-internal-token" },
  });
  expect(res.status).toBe(404);
});
```

> If `app.test.ts` has no `makeDeps` helper, add a small factory at the top of the file that returns a full `AppDeps` (cluster stub, `findApiKey`, `recordUpload`, `forgetUpload`, `replication`, `internalToken: "dev-internal-token"`, `peerService`) and spread overrides — mirroring the existing per-test deps construction.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/api test -- app`
Expected: FAIL — 404/route not found on `/cluster/peers/enriched`, or type error on missing `peerService`.

- [ ] **Step 3: Implement**

In `apps/api/src/app.ts`, add to `AppDeps` (import the type at top: `import type { PeerService } from "./peer-service";`):

```ts
  /** Enriched peer views (files, geo, bytes, history) for the dashboard. */
  peerService: PeerService;
```

In the gateway section, register the enriched routes BEFORE the `:peerId` param route so the static path wins. Add after the existing `gateway.get("/peers", …)` line:

```ts
  gateway.get("/peers/enriched", async (c) => c.json(await deps.peerService.enrichedPeers()));
  gateway.get("/peers/:peerId", async (c) => {
    const detail = await deps.peerService.peerDetail(c.req.param("peerId"));
    return detail ? c.json(detail) : c.json({ error: "peer not found" }, 404);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repo/api test -- app`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app.ts apps/api/test/app.test.ts
git commit -m "feat(api): enriched peer + peer detail gateway routes"
```

---

## Task 10: Wire the peer service in index.ts + config

**Files:**
- Modify: `apps/api/src/config.ts` (add `ipfsApiUrl`)
- Modify: `apps/api/src/index.ts` (construct `peerService`, db-backed deps, pass `resolveSizes` to accounting)

**Interfaces:**
- Consumes: `createPeerService`, `resolveSizes`, db tables `geoipCache`, `pinSizes`, `uploads`, `participants`, `contributionSnapshots`.
- Produces: running server with the new routes and real `bytesHeld`.

- [ ] **Step 1: Add `ipfsApiUrl` to config**

In `apps/api/src/config.ts`, add to the `Config` interface `ipfsApiUrl: string;` and to `loadConfig()`:

```ts
    ipfsApiUrl: process.env.IPFS_API_URL ?? "http://localhost:5001",
```

- [ ] **Step 2: Wire db-backed deps + peerService in index.ts**

In `apps/api/src/index.ts`, extend the imports from `@repo/db` to include `geoipCache`, `pinSizes`, and (for reads) `desc`, `and` as needed from `drizzle-orm`. Then, after `const cluster = new ClusterClient(...)`, build the shared size/geo/db helpers and the peer service:

```ts
import { createPeerService } from "./peer-service";
import { resolveSizes } from "./pin-size";
// add to @repo/db import: geoipCache, pinSizes
// add to drizzle-orm import: desc

const GEO_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const pinSizeStore = {
  async get(cid: string) {
    const [row] = await db.select({ size: pinSizes.size }).from(pinSizes).where(eq(pinSizes.cid, cid)).limit(1);
    return row?.size ?? null;
  },
  async set(cid: string, size: number, source: "upload" | "kubo") {
    await db.insert(pinSizes).values({ cid, size, source }).onConflictDoNothing();
  },
  async uploadSize(cid: string) {
    const [row] = await db.select({ size: uploads.size }).from(uploads).where(eq(uploads.cid, cid)).limit(1);
    return row?.size ?? null;
  },
};

const geoStore = {
  async get(ip: string) {
    const [row] = await db.select().from(geoipCache).where(eq(geoipCache.ip, ip)).limit(1);
    if (!row) return null;
    if (Date.now() - row.fetchedAt.getTime() > GEO_TTL_MS) return null; // expired -> refetch
    return {
      ip: row.ip,
      countryCode: row.countryCode ?? "",
      country: row.country ?? "",
      city: row.city ?? "",
      lat: row.lat ?? 0,
      lon: row.lon ?? 0,
    };
  },
  async set(geo: { ip: string; countryCode: string; country: string; city: string; lat: number; lon: number }) {
    await db
      .insert(geoipCache)
      .values({ ...geo, fetchedAt: new Date() })
      .onConflictDoUpdate({ target: geoipCache.ip, set: { ...geo, fetchedAt: new Date() } });
  },
};

const peerService = createPeerService({
  cluster,
  ipfsApiUrl: config.ipfsApiUrl,
  geo: geoStore,
  pinSize: pinSizeStore,
  async readParticipants() {
    return db
      .select({
        peerId: participants.peerId,
        label: participants.label,
        firstSeenAt: participants.firstSeenAt,
        lastSeenAt: participants.lastSeenAt,
      })
      .from(participants);
  },
  async readSnapshots(peerId: string) {
    return db
      .select({
        capturedAt: contributionSnapshots.capturedAt,
        bytesHeld: contributionSnapshots.bytesHeld,
        cidCount: contributionSnapshots.cidCount,
        online: contributionSnapshots.online,
      })
      .from(contributionSnapshots)
      .where(eq(contributionSnapshots.peerId, peerId))
      .orderBy(desc(contributionSnapshots.capturedAt))
      .limit(200);
  },
});
```

Pass `peerService` into the `createApp({ … })` call (add `peerService,` to the deps object).

- [ ] **Step 3: Give the accounting job a size resolver**

In `apps/api/src/index.ts`, update the accounting tick to pass `resolveSizes`:

```ts
    const tick = () =>
      runAccountingJob({
        cluster,
        saveSnapshots,
        now: () => new Date(),
        resolveSizes: (cids) =>
          resolveSizes(cids, {
            getCached: pinSizeStore.get,
            setCached: pinSizeStore.set,
            uploadSize: pinSizeStore.uploadSize,
            ipfsApiUrl: config.ipfsApiUrl,
          }),
      }).catch((err) => console.error("[accounting] job failed:", err));
```

- [ ] **Step 4: Type-check + full API test run**

Run: `pnpm --filter @repo/api check-types && pnpm --filter @repo/api test`
Expected: no type errors; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config.ts apps/api/src/index.ts
git commit -m "feat(api): wire peer service + size cache into server and accounting"
```

---

## Task 11: Web BFF client methods

**Files:**
- Modify: `apps/web/lib/api.ts` (add types + `getEnrichedPeers`, `getPeerDetail`)

**Interfaces:**
- Consumes: existing `gatewayFetch`.
- Produces:
  - `interface Geo { ip: string; countryCode: string; country: string; city: string; lat: number; lon: number }`
  - `interface EnrichedPeer { id: string; peername: string; ipfsId?: string; version?: string; online: boolean; publicIp: string | null; geo: Geo | null; bytesHeld: number; fileCount: number; firstSeenAt: string | null; lastSeenAt: string | null }`
  - `interface PeerFile { cid: string; name: string; size: number | null; syncedAt: string | null; status: string }`
  - `interface PeerSnapshot { capturedAt: string; bytesHeld: number; cidCount: number; online: boolean }`
  - `interface PeerDetail extends EnrichedPeer { addresses: string[]; files: PeerFile[]; snapshots: PeerSnapshot[] }`
  - `getEnrichedPeers(): Promise<EnrichedPeer[]>`; `getPeerDetail(peerId: string): Promise<PeerDetail | null>`

- [ ] **Step 1: Add types + functions**

Append to `apps/web/lib/api.ts` (dates arrive as ISO strings over JSON):

```ts
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

export async function getPeerDetail(peerId: string): Promise<PeerDetail | null> {
  const res = await fetch(`${HONO_URL}/cluster/peers/${encodeURIComponent(peerId)}`, {
    headers: { "x-internal-token": INTERNAL_TOKEN },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API /peers/${peerId} failed: ${res.status}`);
  return res.json() as Promise<PeerDetail>;
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter web check-types`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/api.ts
git commit -m "feat(web): BFF client for enriched peers + peer detail"
```

---

## Task 12: Contribution chart (pure path + component)

**Files:**
- Create: `apps/web/lib/chart.ts`
- Test: `apps/web/lib/chart.test.ts`
- Create: `apps/web/components/contribution-chart.tsx`

**Interfaces:**
- Produces: `buildAreaPath(values: number[], width: number, height: number): { line: string; area: string }`; `<ContributionChart points={PeerSnapshot[]} />`.

- [ ] **Step 1: Write the failing test**

`apps/web/lib/chart.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildAreaPath } from "./chart";

describe("buildAreaPath", () => {
  it("maps values into an SVG path within the viewport", () => {
    const { line, area } = buildAreaPath([0, 5, 10], 100, 20);
    // first point at x=0, last at x=100
    expect(line.startsWith("M0,")).toBe(true);
    expect(line).toContain("100,");
    // area closes back to the baseline
    expect(area.trim().endsWith("Z")).toBe(true);
  });

  it("returns empty paths for fewer than two points", () => {
    expect(buildAreaPath([7], 100, 20)).toEqual({ line: "", area: "" });
    expect(buildAreaPath([], 100, 20)).toEqual({ line: "", area: "" });
  });

  it("handles a flat series without dividing by zero", () => {
    const { line } = buildAreaPath([4, 4, 4], 100, 20);
    expect(line).not.toContain("NaN");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- chart`
Expected: FAIL — cannot find module `./chart`.

- [ ] **Step 3: Implement the pure path builder**

`apps/web/lib/chart.ts`:

```ts
/**
 * Build SVG path strings for a simple area/line chart. Values are sampled
 * left-to-right across `width`; y is scaled to `height` (higher value = higher
 * on screen). Returns empty strings when there is nothing to draw.
 */
export function buildAreaPath(
  values: number[],
  width: number,
  height: number,
): { line: string; area: string } {
  if (values.length < 2) return { line: "", area: "" };
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = Math.round(i * stepX * 100) / 100;
    const y = Math.round((height - ((v - min) / span) * height) * 100) / 100;
    return `${x},${y}`;
  });
  const line = `M${points.join(" L")}`;
  const area = `${line} L${width},${height} L0,${height} Z`;
  return { line, area };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- chart`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement the component**

`apps/web/components/contribution-chart.tsx`:

```tsx
import type { PeerSnapshot } from "@/lib/api";
import { buildAreaPath } from "@/lib/chart";

const W = 640;
const H = 120;

/** Area chart of bytes held over time (oldest -> newest, left -> right). */
export function ContributionChart({ points }: { points: PeerSnapshot[] }) {
  // Snapshots arrive newest-first; reverse for chronological left-to-right.
  const chronological = [...points].reverse();
  const values = chronological.map((p) => p.bytesHeld);
  const { line, area } = buildAreaPath(values, W, H);

  if (!line) {
    return <p className="text-sm text-muted-foreground">Not enough history yet.</p>;
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-32 w-full" preserveAspectRatio="none" role="img" aria-label="Bytes held over time">
      <path d={area} className="fill-primary/10" />
      <path d={line} className="fill-none stroke-primary" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/chart.ts apps/web/lib/chart.test.ts apps/web/components/contribution-chart.tsx
git commit -m "feat(web): dependency-free SVG contribution chart"
```

---

## Task 13: Enrich the peers overview page

**Files:**
- Modify: `apps/web/app/dashboard/peers/page.tsx`

**Interfaces:**
- Consumes: `getEnrichedPeers` (Task 11).

- [ ] **Step 1: Add a byte-formatting helper**

Create `apps/web/lib/format.ts` if it does not already exist (check first: `ls apps/web/lib/format.ts`). If absent, create it:

```ts
/** Human-readable byte size, e.g. 1536 -> "1.5 KB". */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
```

If it already exists with a byte formatter, reuse that name instead.

- [ ] **Step 2: Rewrite the peers page to use enriched data**

Replace the body of `apps/web/app/dashboard/peers/page.tsx` with:

```tsx
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getEnrichedPeers } from "@/lib/api";
import { formatBytes } from "@/lib/format";

export const dynamic = "force-dynamic";

function flag(countryCode: string): string {
  if (countryCode.length !== 2) return "";
  return String.fromCodePoint(...[...countryCode.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export default async function PeersPage() {
  let peers: Awaited<ReturnType<typeof getEnrichedPeers>> = [];
  let error: string | null = null;
  try {
    peers = await getEnrichedPeers();
  } catch (err) {
    error = err instanceof Error ? err.message : "Cluster unreachable";
  }

  return (
    <>
      <PageHeader title="Peers & Followers" description="Cluster peers and participant followers — location, data held, and reachability." />
      <Card>
        <CardContent>
          {error ? (
            <p className="font-mono text-sm text-destructive">{error}</p>
          ) : peers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No peers reported yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Peer</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead className="text-right">Data held</TableHead>
                  <TableHead className="text-right">Files</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {peers.map((peer) => (
                  <TableRow key={peer.id}>
                    <TableCell className="font-medium">
                      <Link href={`/dashboard/peers/${encodeURIComponent(peer.id)}`} className="hover:underline">
                        {peer.peername || peer.id.slice(0, 12)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {peer.geo ? `${flag(peer.geo.countryCode)} ${peer.geo.city || peer.geo.country}` : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{peer.publicIp ?? "—"}</TableCell>
                    <TableCell className="text-right">{formatBytes(peer.bytesHeld)}</TableCell>
                    <TableCell className="text-right">{peer.fileCount}</TableCell>
                    <TableCell className="text-right">
                      {peer.online ? <Badge variant="secondary">online</Badge> : <Badge variant="destructive">down</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
```

- [ ] **Step 3: Type-check + lint**

Run: `pnpm --filter web check-types && pnpm --filter web lint`
Expected: no errors. (If `lint` is not defined per-package, run root `pnpm lint`.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/format.ts apps/web/app/dashboard/peers/page.tsx
git commit -m "feat(web): enrich peers overview with location, IP, data held"
```

---

## Task 14: Peer detail page

**Files:**
- Create: `apps/web/app/dashboard/peers/[peerId]/page.tsx`

**Interfaces:**
- Consumes: `getPeerDetail` (Task 11), `ContributionChart` (Task 12), `formatBytes` (Task 13).

- [ ] **Step 1: Create the detail page**

`apps/web/app/dashboard/peers/[peerId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { ContributionChart } from "@/components/contribution-chart";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getPeerDetail } from "@/lib/api";
import { formatBytes } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PeerDetailPage({ params }: { params: Promise<{ peerId: string }> }) {
  const { peerId } = await params;
  const peer = await getPeerDetail(peerId);
  if (!peer) notFound();

  return (
    <>
      <PageHeader
        title={peer.peername || peer.id.slice(0, 16)}
        description={peer.online ? "Online — replicating the company pinset." : "Currently unreachable."}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Identity</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Peer ID" value={peer.id} mono />
            <Row label="IPFS ID" value={peer.ipfsId ?? "—"} mono />
            <Row label="Version" value={peer.version ?? "—"} />
            <Row label="Status" value={peer.online ? "online" : "down"} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Location & data</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Public IP" value={peer.publicIp ?? "—"} mono />
            <Row label="Location" value={peer.geo ? `${peer.geo.city || "—"}, ${peer.geo.country} (${peer.geo.countryCode})` : "—"} />
            <Row label="Data held" value={formatBytes(peer.bytesHeld)} />
            <Row label="Files" value={String(peer.fileCount)} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Contribution over time</CardTitle></CardHeader>
        <CardContent><ContributionChart points={peer.snapshots} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Files synced ({peer.files.length})</CardTitle></CardHeader>
        <CardContent>
          {peer.files.length === 0 ? (
            <p className="text-sm text-muted-foreground">No files allocated to this peer yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>CID</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead>Synced</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {peer.files.map((f) => (
                  <TableRow key={f.cid}>
                    <TableCell className="font-medium">{f.name || "—"}</TableCell>
                    <TableCell className="max-w-55 truncate font-mono text-xs">{f.cid}</TableCell>
                    <TableCell className="text-right">{f.size != null ? formatBytes(f.size) : "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {f.syncedAt ? new Date(f.syncedAt).toISOString().slice(0, 16).replace("T", " ") : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={f.status === "pinned" ? "secondary" : "outline"}>{f.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "max-w-60 truncate font-mono text-xs" : ""}>{value}</span>
    </div>
  );
}
```

- [ ] **Step 2: Type-check + lint**

Run: `pnpm --filter web check-types && pnpm --filter web lint`
Expected: no errors. (Fallback: root `pnpm lint`.)

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/dashboard/peers/[peerId]/page.tsx"
git commit -m "feat(web): peer detail page with files, geo, and contribution chart"
```

---

## Task 15: Full verification + docker-compose env

**Files:**
- Modify: `docker-compose.prod.yml` (add `IPFS_API_URL` to the `api` service), `docker-compose.yml` (add `IPFS_API_URL` to the follower/api env if applicable)

**Interfaces:** none (integration/verification task).

- [ ] **Step 1: Add IPFS_API_URL to the API service in prod compose**

In `docker-compose.prod.yml`, under the `api` service `environment:`, add:

```yaml
      IPFS_API_URL: http://kubo:5001
```

- [ ] **Step 2: Run the whole workspace test + type-check suite**

Run: `pnpm test && pnpm check-types`
Expected: all packages pass (api, web, db).

- [ ] **Step 3: Manual smoke (local infra)**

Run the infra and dev servers, then verify the pages render:

```bash
pnpm infra:up
pnpm dev
```

Visit `http://localhost:3000/dashboard/peers` — confirm the enriched columns show (location/IP may be "—" for a local-only node, which is expected). Click a peer → confirm the detail page renders identity, files table, and the chart placeholder ("Not enough history yet." until snapshots accrue).

Expected: no runtime errors in the Next or API logs; the peers table and a peer detail page both load.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.prod.yml docker-compose.yml
git commit -m "chore: set IPFS_API_URL for the API service (pin size fallback)"
```

---

## Self-Review

**Spec coverage:**
- Geo-location from IP → Tasks 2 (IP), 4 (geo), 7/8 (assembly), 13/14 (UI). ✓
- Real bytes held → Tasks 5 (size), 6 (accounting), 7 (per-peer sum). ✓
- Per-file sync timestamps → Tasks 3 (pinStatuses), 7 (files with syncedAt), 14 (UI). ✓
- Contribution chart → Tasks 10 (readSnapshots), 12 (chart), 14 (render). ✓
- Two cache tables only → Task 1. ✓
- Web-never-calls-cluster boundary → all cluster access in `apps/api`; web uses `lib/api.ts`. ✓
- Best-effort degradation → geo/size resolvers return null; UI shows "—". ✓
- `IPFS_API_URL`/geo env with dev fallbacks → Tasks 10, 15. ✓

**Placeholder scan:** No TBD/TODO; every code step has full code. ✓

**Type consistency:** `EnrichedPeer`/`PeerDetail`/`PeerFile`/`SnapshotRow` defined in Task 7, re-declared for the wire (ISO-string dates) in Task 11, and consumed in 13/14. `resolveSizes`/`resolveSize` signatures match across Tasks 5, 6, 8, 10. `pinStatuses`/`PinStatus` match across Tasks 3, 7, 8. `buildSnapshots` 4-arg signature updated consistently in Task 6. ✓
