# Peers page — List / Map tabs with custom participant pins

Date: 2026-07-17
Status: Approved (design), pending implementation plan

## Summary

Split the Peers page into two tabs:

- **List** — the existing peers table, unchanged.
- **Map** — a self-contained SVG world map that plots each peer at its resolved
  geo-location, with **custom pins that distinguish participant followers from
  infrastructure cluster peers**.

No API or data-model changes are required: every peer returned by
`getEnrichedPeers()` already carries `geo` with `lat`/`lon`/`city`/`country`/
`countryCode` (see `apps/web/lib/api.ts`, `Geo`/`EnrichedPeer`).

## Goals

- Add a List/Map tab switch to `/dashboard/peers` without changing the existing
  table behavior.
- Render an offline-capable map (no external tile/network requests) that fits
  the dashboard theme in light and dark mode.
- Give participant followers (peers with `subscribedTags`) visually distinct,
  identity-bearing pins vs. plain cluster peers.
- Never silently drop data: peers without a resolved location must still be
  surfaced.

## Non-goals

- Street-level pan/zoom (the self-contained SVG map shows country/city-level
  positions only — sufficient for peer locations).
- Live/streaming updates on the map (it reflects the same server fetch as the
  page; the existing "Refresh locations" action still drives updates).
- Persisting the selected tab to the URL.
- A component/DOM test harness — the repo currently has no tests or vitest
  config; see Testing.

## Key decisions (resolved during brainstorming)

1. **Map rendering: self-contained SVG map.** `d3-geo` projection + a bundled
   `world-atlas` topojson, converted with `topojson-client`. No external tile
   server, works offline/air-gapped, fully themeable. (Rejected: OSM tile map —
   external requests + privacy concern for a self-hosted cluster; 3D globe —
   heavy and overkill.)
2. **Pin style: role shape + identity label.** Cluster peers render as a small
   neutral diamond glyph; participants render as a labeled pin showing peername
   initials, tinted by a stable tag-derived color, with a status ring. (Rejected:
   uniform color-coded dots; single tag-colored teardrop for all.)

## Architecture

The page stays a **server component**; the fetch is unchanged. Tab UI and the
map are **client** components fed by the already-fetched data.

### Files

| File | Change | Purpose |
|------|--------|---------|
| `apps/web/app/dashboard/peers/page.tsx` | edit | Fetch as today; render `<PageHeader>` + `<PeersView peers locationsUpdatedAt error />`. |
| `apps/web/components/ui/tabs.tsx` | new | shadcn-style wrapper over `@base-ui/react/tabs` (`Tabs`, `TabsList`, `TabsTrigger`, `TabsPanel`), matching how `ui/dropdown-menu.tsx` wraps `@base-ui/react/menu`. |
| `apps/web/components/peers-view.tsx` | new (client) | Card + the "Locations updated / Refresh" header row + List/Map tabs. Owns the error/empty branches (see below). |
| `apps/web/components/peers-table.tsx` | new (client) | The existing table markup extracted verbatim, incl. the `flag()` helper. |
| `apps/web/components/peers-map.tsx` | new (client) | The SVG world map, pins, hover card, legend, unlocated list. |
| `apps/web/lib/peer-map.ts` | new | Pure helpers: `tagColor(tag)`, `initials(peername)`, `groupByLocation(peers)`, projection/placement helper. Kept separate so they are unit-testable without React. |

### Dependencies to add (to `apps/web`)

- `d3-geo` + `@types/d3-geo`
- `topojson-client` + `@types/topojson-client`
- `world-atlas` (bundled `countries-110m.json` topojson data)

All are bundled at build time — no runtime network calls.

## Data flow

1. `page.tsx` calls `getEnrichedPeers()` server-side exactly as today, catching
   errors into an `error` string.
2. It passes `peers`, `locationsUpdatedAt`, and `error` into `<PeersView>`.
3. `PeersView` renders the header row + tabs. Tab switching and all map
   interaction are **pure client state** — no refetch.
4. The existing `refreshPeerLocations()` server action still revalidates the
   page; both tabs reflect the refreshed data on the next render.

## Error / empty states (preserve current behavior)

`PeersView` mirrors today's logic in `page.tsx`:

- `error` present → destructive message, **no tabs**.
- `peers.length === 0` → "No peers reported yet.", **no tabs**.
- otherwise → header row + List/Map tabs.

## Map component detail (`peers-map.tsx`)

- **Projection:** `geoEqualEarth()` fitted (`fitSize`) to a fixed viewBox (e.g.
  `800×400`) so the SVG scales responsively to the card width.
- **Base layer:** `topojson.feature(worldAtlas, worldAtlas.objects.countries)`
  drawn via `geoPath(projection)`. Fill `fill-muted` (~40% opacity), stroke
  `stroke-border`. Themes automatically via existing CSS variables.
- **Pins:**
  - *Cluster peer* (`subscribedTags.length === 0`): small diamond glyph,
    neutral fill, ring color by status.
  - *Participant* (`subscribedTags.length > 0`): rounded marker with peername
    initials (`initials(peername)`, 1–2 chars), background tinted by
    `tagColor(subscribedTags[0])` (deterministic hash → HSL; tags have no stored
    color today), bottom pointer.
  - *Status:* online → green ring + subtle pulse, suppressed under
    `motion-reduce` (reuse the `PeerStatus` pattern); offline → muted + dimmed.
- **Co-location:** peers are grouped by resolved location via
  `groupByLocation()` (key = rounded `lat,lon`). A group renders one pin; when
  `count > 1` it shows a count badge, and its hover card lists each member as a
  link to that peer's detail page.
- **Hover / focus:** a small hover card shows peername, role
  (cluster/participant), tags, data held (`formatBytes`), online status +
  since/last-seen (`timeAgo`). Markers are keyboard-focusable
  (`tabIndex`, `role="button"`); **Enter / click** navigates to
  `/dashboard/peers/{id}` (single-member groups) — same target as the table row
  link.
- **Legend:** a compact row — cluster glyph · participant pin · online color ·
  offline color.
- **Unlocated peers:** peers with `geo == null` cannot be placed. They render
  below the map as a muted line — "*N peers without a resolved location*" — each
  name linking to its detail page, so no peer is silently hidden.

## Pure helpers (`lib/peer-map.ts`)

- `tagColor(tag: string): string` — stable hash of the tag string → HSL color;
  same input always yields the same color.
- `initials(peername: string): string` — 1–2 uppercase initials; falls back to
  the first chars of the peer id when peername is empty.
- `groupByLocation(peers): LocatedGroup[]` — groups peers sharing a rounded
  `lat,lon`; drops peers with `geo == null` into a separate `unlocated` array.
- A placement helper wrapping `projection([lon, lat])` → `[x, y]` (or `null`
  when off-projection).

## Testing

The repo has **no tests and no vitest config anywhere** today, though `apps/web`
already has `vitest` as a devDependency and a `test` script. To match the repo's
reality and avoid bootstrapping a DOM/testing-library harness it doesn't have:

- Add **unit tests for the pure helpers only** (`lib/peer-map.ts`) — these run
  under plain `vitest` with no jsdom: `tagColor` determinism, `initials`
  extraction + fallback, `groupByLocation` grouping and unlocated split, and the
  placement helper returning expected quadrants for known lat/lon.
- A minimal `vitest.config.ts` (node environment) will be added to `apps/web` so
  `pnpm --filter web test` runs.
- Component/render tests are **deferred** (would require introducing jsdom +
  testing-library, out of pattern for a repo with zero tests). Manual
  verification: load `/dashboard/peers`, confirm both tabs, pins, hover card,
  status colors, co-location badge, and the unlocated list.

## Risks / open questions

- **base-ui Tabs API** — confirmed `@base-ui/react/tabs` exists (v1.6.0);
  wrapper follows the existing `dropdown-menu.tsx` pattern.
- **world-atlas bundle size** — `countries-110m.json` is ~100 KB; acceptable and
  loaded only on the (client) map component. Could be lazy-loaded with the Map
  tab if bundle impact is a concern.
- **Tag color palette** — hashed HSL is deterministic but not curated; if a
  designed tag palette is wanted later, `tagColor` is the single swap point.
