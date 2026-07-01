# Peer Observability — Design

**Date:** 2026-07-01
**Status:** Approved (design), pending implementation plan
**Audience for the feature:** Operator (private admin monitoring view)

## Goal

Expand the dashboard's peer view from a flat 4-column table into a rich,
operator-facing observability surface: for each cluster peer / participant
follower, show the files it has synced (and when), its public IP and
geographic location, real bytes held, and its contribution over time.

## Scope (v1)

In scope — all four enrichments confirmed:

1. **Geo-location from IP** — resolve each peer's public IP to country/city.
2. **Real bytes held per peer** — replace the hardcoded `bytesHeld = 0`.
3. **Per-file sync timestamps** — when each file finished pinning on a peer.
4. **Contribution chart over time** — from `contributionSnapshots`.

Out of scope: participant-facing / public views, privacy scoping, alerting,
rewards computation. This is an internal operator tool, so peer IPs and
locations are shown in full (no anonymization).

## Approach

**Hybrid (chosen over "enrich on read" and "materialize in accounting job").**

- Read volatile data **live** every render (current pins, per-peer sync
  status, addresses/IP) so the view is always fresh.
- Cache only the two lookups that are expensive **and** stable:
  - **pin sizes** — a CID's size is immutable, so cache once, forever.
  - **geoIP** — an IP's location changes rarely; cache with a TTL.
- The periodic accounting job reuses the pin-size cache to persist a real
  `bytesHeld` per snapshot, making the contribution chart meaningful.

Rationale: caches exactly the two things that are costly-and-stable and
nothing else — freshness where it matters, no premature materialization.

## Architecture & boundaries

Preserve the existing rule: **the web app never calls the cluster directly.**
All new cluster / Kubo / GeoIP calls live server-side in `apps/api` (Hono),
reached from Next via `lib/api.ts` `gatewayFetch` with the internal token.

```
Next server component (peers list / detail)
  └─ lib/api.ts gatewayFetch
       └─ Hono /cluster/*
            ├─ cluster REST (CLUSTER_API_URL, :9094)
            ├─ Kubo RPC     (IPFS_API_URL,   :5001)  — size fallback
            ├─ GeoIP API    (ip-api.com)             — location
            └─ Postgres: geoip_cache, pin_sizes
```

### New / changed API endpoints (Hono `apps/api`)

- `GET /cluster/peers/enriched` — array of peers, each with:
  `id, peername, ipfsId, version, error/status, publicIp, geo,
  bytesHeld, fileCount, firstSeen, lastSeen`. Drives the overview table.
- `GET /cluster/peers/:peerId` — detail for one peer:
  identity + `addresses[]`, `publicIp`, `geo`,
  `files[] { cid, name, size, syncedAt, status }`,
  `snapshots[] { capturedAt, bytesHeld, cidCount, online }`.

Both are internal-token gated like the existing `/cluster/*` gateway routes.

### New ClusterClient capability

- `pinStatuses()` — parse the cluster global pin-status stream
  (`GET /pins` → `GlobalPinInfo.peer_map[peerId] = { status, timestamp }`).
  Returns per-CID, per-peer `{ status, timestamp }`. Joined with the pinset
  (`allocations` + `name`) to build each peer's file list with sync times.

## Data sources (per field — no guessing)

| Field | Source | Notes |
|---|---|---|
| Public IP | pure fn over peer `addresses[]` | drop loopback / RFC1918 / private; first public `/ip4` or `/ip6` |
| Geo | `publicIp` → ip-api.com | cached in `geoip_cache`, TTL ~30d; no API key |
| Files + sync time | `ClusterClient.pinStatuses()` | `peer_map[peerId].{status,timestamp}` joined to pinset for names |
| Bytes / pin size | `uploads.size` first, else Kubo `dag/stat` | cached in `pin_sizes` (immutable); `source` records origin |
| bytesHeld per peer | Σ `pin_sizes.size` for pins allocated to peer | computed live for detail; persisted by accounting job for history |
| Contribution chart | `contributionSnapshots` time series | now carries real `bytesHeld` |

## Schema additions

Two cache tables only. No shape change to `participants` /
`contributionSnapshots` (the accounting job simply starts writing a real
`bytesHeld` instead of `0`).

```
geoip_cache
  ip            text  primary key
  country_code  text
  country       text
  city          text
  lat           double
  lon           double
  fetched_at    timestamp

pin_sizes
  cid         text  primary key
  size        bigint
  source      text          -- 'upload' | 'kubo'
  fetched_at  timestamp
```

## Env vars (all with dev fallbacks)

- `IPFS_API_URL` — Kubo RPC base, default `http://kubo:5001` (already the
  service name in compose). Used only for the size fallback.
- `GEOIP_PROVIDER` — default `ip-api` (zero config). Optional `IPINFO_TOKEN`
  if we later switch providers.

## UI

- **Peers overview** (`apps/web/app/dashboard/peers/page.tsx`) — enrich the
  existing table with columns: location (flag + country), public IP, bytes
  held, file count, last seen, status. Each row links to the detail page.
- **Peer detail** (new `apps/web/app/dashboard/peers/[peerId]/page.tsx`):
  - Identity card: peername, label, peer ID, IPFS ID, version, addresses.
  - Location card: public IP + geo (country/city).
  - **Files synced** table: cid, name, size, synced-at, status.
  - **Contribution chart**: bytes held / file count over time.
  - Chart library: reuse whatever the app already bundles; if none, pick a
    lightweight charting lib (decided at implementation time).

## Error handling

- Cluster / Kubo / GeoIP unreachable → the enriched endpoints degrade
  gracefully: missing geo shows "—", unknown size shows "—", cluster-down
  shows the existing error banner. A failed GeoIP or size lookup never fails
  the whole page — it is best-effort per field, matching the existing
  register/status best-effort pattern.
- GeoIP rate limits (ip-api free = 45 req/min): the cache absorbs repeat
  lookups; a miss that hits the limit is treated as "unknown" for that render
  and retried on the next.

## Testing

- Pure functions get unit tests: public-IP extraction (loopback/private
  filtering, ip4/ip6, no-public-addr case), per-peer bytes aggregation,
  snapshot building with real sizes.
- `ClusterClient.pinStatuses()`, the GeoIP resolver, and the size resolver get
  tests with mocked `fetch`, matching the existing `cluster-client.test.ts`
  and `accounting.test.ts` patterns.
- No network access in tests.

## Non-goals / deferred

- Historical geo/IP change tracking (only latest cached value kept).
- Real-time streaming updates (page is request-time fresh, no websockets).
- Rewards / incentive math on top of contribution data.
