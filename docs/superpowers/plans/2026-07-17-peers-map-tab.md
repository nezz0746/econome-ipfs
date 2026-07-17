# Peers Page List/Map Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `/dashboard/peers` into a **List** tab (the existing table) and a **Map** tab that plots each peer on a self-contained SVG world map with custom pins distinguishing participant followers from cluster peers.

**Architecture:** The page stays a server component; its fetch is unchanged. A new client `PeersView` renders base-ui Tabs over the existing table and a new `PeersMap`. The map is drawn with `d3-geo` + a bundled `world-atlas` topojson (no network). All non-React logic lives in a pure, unit-tested `lib/peer-map.ts`.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, `@base-ui/react`, `d3-geo`, `topojson-client`, `world-atlas`, Vitest, Biome.

## Global Constraints

- **No external network requests from the map** — country geometry is bundled (`world-atlas`), not fetched.
- **No API/data-model changes** — everything reads the existing `EnrichedPeer` shape from `@/lib/api` (`geo: { lat, lon, city, country, countryCode, ip } | null`, `subscribedTags: string[]`).
- **Import alias:** `@/*` → `apps/web/*` (tsconfig `paths`).
- **Peer detail route:** `/dashboard/peers/[peerId]` — links use `` `/dashboard/peers/${encodeURIComponent(peer.id)}` ``.
- **Participant vs cluster peer:** a peer is a *participant* when `subscribedTags.length > 0`, else a *cluster peer*.
- **Formatting/lint:** run `pnpm --filter web exec biome format --write <files>` before each commit; the repo uses Biome (2-space indent, double quotes, trailing commas).
- **Typecheck gate:** `pnpm --filter web check-types` must pass (runs `next typegen && tsc --noEmit`).
- **Commit style:** Conventional Commits, `feat(web): …` / `test(web): …` / `chore(web): …`.
- **Theme tokens available (verified in `app/globals.css`):** `--ring`, `--background`, `--foreground`, `--muted`, `--muted-foreground`, `--popover`, `--popover-foreground`, `--border`, `--primary`, `--card`, `--accent`, `--destructive`. Tailwind utilities `fill-muted`, `fill-muted-foreground`, `fill-foreground`, `fill-background`, `bg-popover`, `text-popover-foreground` resolve from these.

---

### Task 1: Install map deps + add the Tabs UI primitive

**Files:**
- Modify: `apps/web/package.json` (dependencies — via pnpm)
- Create: `apps/web/components/ui/tabs.tsx`

**Interfaces:**
- Produces: `@/components/ui/tabs` exporting `Tabs`, `TabsList`, `TabsTrigger`, `TabsPanel` (thin wrappers over `@base-ui/react/tabs`).

- [ ] **Step 1: Install dependencies**

Run:
```bash
pnpm --filter web add d3-geo topojson-client world-atlas
pnpm --filter web add -D @types/d3-geo @types/topojson-client
```
Expected: `apps/web/package.json` now lists `d3-geo`, `topojson-client`, `world-atlas` under dependencies and the two `@types/*` under devDependencies; lockfile updates.

- [ ] **Step 2: Create the Tabs wrapper**

Create `apps/web/components/ui/tabs.tsx` (base-ui emits `aria-selected` on the active tab — style with `aria-selected:`):

```tsx
"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "@/lib/utils";

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-4", className)}
      {...props}
    />
  );
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-sm [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      className={cn("outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsPanel };
```

- [ ] **Step 3: Verify it typechecks**

Run: `pnpm --filter web check-types`
Expected: PASS (no type errors). This is the verification gate for this task — there is no DOM test harness in the repo.

- [ ] **Step 4: Format + commit**

```bash
pnpm --filter web exec biome format --write components/ui/tabs.tsx
git add apps/web/package.json apps/web/components/ui/tabs.tsx ../../pnpm-lock.yaml
git commit -m "feat(web): add map deps and base-ui Tabs primitive"
```
(If the lockfile path differs, `git add -A` the repo root lockfile.)

---

### Task 2: Pure helpers — `tagColor` + `initials` (TDD)

**Files:**
- Create: `apps/web/lib/peer-map.ts`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/lib/peer-map.test.ts`

**Interfaces:**
- Produces:
  - `tagColor(tag: string): string` — deterministic `hsl(...)` string.
  - `initials(name: string, fallbackId?: string): string` — 1–2 uppercase chars.

- [ ] **Step 1: Add the vitest config**

Create `apps/web/vitest.config.ts` (node env; mirror the `@` alias so `@/lib/...` imports resolve in tests):

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/lib/peer-map.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { initials, tagColor } from "@/lib/peer-map";

describe("tagColor", () => {
  it("is deterministic for the same tag", () => {
    expect(tagColor("media")).toBe(tagColor("media"));
  });

  it("differs across distinct tags and is an hsl() string", () => {
    expect(tagColor("media")).toMatch(/^hsl\(/);
    expect(tagColor("media")).not.toBe(tagColor("docs"));
  });
});

describe("initials", () => {
  it("takes the first letter of the first two words", () => {
    expect(initials("nezzar kefif")).toBe("NK");
    expect(initials("nezzar_kefif")).toBe("NK");
  });

  it("uses the first two chars for a single word", () => {
    expect(initials("media")).toBe("ME");
  });

  it("falls back to the id when the name is empty", () => {
    expect(initials("", "12D3KooWabc")).toBe("12");
  });

  it("returns a placeholder when nothing is available", () => {
    expect(initials("", "")).toBe("?");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter web test -- lib/peer-map.test.ts`
Expected: FAIL — cannot resolve `@/lib/peer-map` (module not created yet).

- [ ] **Step 4: Create the helpers**

Create `apps/web/lib/peer-map.ts`:

```ts
/** Deterministic HSL color derived from a tag string (stable across renders). */
export function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 65% 45%)`;
}

/** 1–2 uppercase initials from a peername, falling back to a peer id. */
export function initials(name: string, fallbackId = ""): string {
  const source = name.trim() || fallbackId;
  if (!source) return "?";
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter web test -- lib/peer-map.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 6: Format + commit**

```bash
pnpm --filter web exec biome format --write lib/peer-map.ts lib/peer-map.test.ts vitest.config.ts
git add apps/web/lib/peer-map.ts apps/web/lib/peer-map.test.ts apps/web/vitest.config.ts
git commit -m "test(web): add tagColor and initials peer-map helpers"
```

---

### Task 3: Pure helper — `groupByLocation` (TDD)

**Files:**
- Modify: `apps/web/lib/peer-map.ts`
- Modify: `apps/web/lib/peer-map.test.ts`

**Interfaces:**
- Consumes: `EnrichedPeer`, `Geo` from `@/lib/api`.
- Produces:
  - `interface LocatedGroup { key: string; lat: number; lon: number; city: string; countryCode: string; peers: EnrichedPeer[]; }`
  - `interface GroupedPeers { groups: LocatedGroup[]; unlocated: EnrichedPeer[]; }`
  - `groupByLocation(peers: EnrichedPeer[]): GroupedPeers`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/lib/peer-map.test.ts`:

```ts
import type { EnrichedPeer } from "@/lib/api";
import { groupByLocation } from "@/lib/peer-map";

function makePeer(overrides: Partial<EnrichedPeer>): EnrichedPeer {
  return {
    id: "id",
    peername: "",
    online: true,
    publicIp: null,
    geo: null,
    bytesHeld: 0,
    fileCount: 0,
    subscribedTags: [],
    firstSeenAt: null,
    lastSeenAt: null,
    onlineSince: null,
    ...overrides,
  };
}

function geo(lat: number, lon: number, city = "City") {
  return { ip: "1.2.3.4", countryCode: "FR", country: "France", city, lat, lon };
}

describe("groupByLocation", () => {
  it("buckets co-located peers into one group", () => {
    const { groups, unlocated } = groupByLocation([
      makePeer({ id: "a", geo: geo(48.85, 2.35) }),
      makePeer({ id: "b", geo: geo(48.85, 2.35) }),
    ]);
    expect(unlocated).toHaveLength(0);
    expect(groups).toHaveLength(1);
    expect(groups[0].peers.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("separates distinct locations and collects peers without geo", () => {
    const { groups, unlocated } = groupByLocation([
      makePeer({ id: "a", geo: geo(48.85, 2.35) }),
      makePeer({ id: "b", geo: geo(51.5, -0.13) }),
      makePeer({ id: "c", geo: null }),
    ]);
    expect(groups).toHaveLength(2);
    expect(unlocated.map((p) => p.id)).toEqual(["c"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- lib/peer-map.test.ts`
Expected: FAIL — `groupByLocation` is not exported.

- [ ] **Step 3: Implement `groupByLocation`**

Append to `apps/web/lib/peer-map.ts`:

```ts
import type { EnrichedPeer } from "@/lib/api";

export interface LocatedGroup {
  /** Stable key = rounded "lat,lon" (bucketed to ~city level). */
  key: string;
  lat: number;
  lon: number;
  city: string;
  countryCode: string;
  peers: EnrichedPeer[];
}

export interface GroupedPeers {
  groups: LocatedGroup[];
  unlocated: EnrichedPeer[];
}

/**
 * Split peers into geo-located groups (co-located peers share one pin) and an
 * unlocated list (peers with `geo == null`).
 */
export function groupByLocation(peers: EnrichedPeer[]): GroupedPeers {
  const byKey = new Map<string, LocatedGroup>();
  const unlocated: EnrichedPeer[] = [];
  for (const peer of peers) {
    if (!peer.geo) {
      unlocated.push(peer);
      continue;
    }
    const { lat, lon, city, countryCode } = peer.geo;
    const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.peers.push(peer);
    } else {
      byKey.set(key, { key, lat, lon, city, countryCode, peers: [peer] });
    }
  }
  return { groups: [...byKey.values()], unlocated };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- lib/peer-map.test.ts`
Expected: PASS.

- [ ] **Step 5: Format + commit**

```bash
pnpm --filter web exec biome format --write lib/peer-map.ts lib/peer-map.test.ts
git add apps/web/lib/peer-map.ts apps/web/lib/peer-map.test.ts
git commit -m "test(web): add groupByLocation peer-map helper"
```

---

### Task 4: World map projection — `createWorldMap` (TDD)

**Files:**
- Modify: `apps/web/lib/peer-map.ts`
- Modify: `apps/web/lib/peer-map.test.ts`

**Interfaces:**
- Consumes: `d3-geo`, `topojson-client`, `world-atlas/countries-110m.json` (from Task 1).
- Produces:
  - `interface WorldMap { width: number; height: number; countryPaths: string[]; project(lon: number, lat: number): [number, number] | null; }`
  - `createWorldMap(width: number, height: number): WorldMap`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/lib/peer-map.test.ts`:

```ts
import { createWorldMap } from "@/lib/peer-map";

describe("createWorldMap", () => {
  const map = createWorldMap(800, 400);

  it("produces country outline paths", () => {
    expect(map.countryPaths.length).toBeGreaterThan(50);
    expect(map.countryPaths[0]).toMatch(/^M/);
  });

  it("projects London north-west of Sydney", () => {
    const london = map.project(-0.13, 51.5);
    const sydney = map.project(151.2, -33.9);
    expect(london).not.toBeNull();
    expect(sydney).not.toBeNull();
    // Smaller x = further west; smaller y = further north.
    expect(london![0]).toBeLessThan(sydney![0]);
    expect(london![1]).toBeLessThan(sydney![1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- lib/peer-map.test.ts`
Expected: FAIL — `createWorldMap` is not exported.

- [ ] **Step 3: Implement `createWorldMap`**

Append the import at the top of `apps/web/lib/peer-map.ts` (with the other imports) and the function at the bottom:

```ts
import { geoEqualEarth, geoPath } from "d3-geo";
import { feature } from "topojson-client";
// world-atlas ships a bundled TopoJSON of country borders (~100 KB). No network.
import worldData from "world-atlas/countries-110m.json";

export interface WorldMap {
  width: number;
  height: number;
  countryPaths: string[];
  project(lon: number, lat: number): [number, number] | null;
}

/**
 * Build a self-contained equal-area world map: SVG country outline `d` strings
 * plus a projector from [lon, lat] to [x, y] within the given viewBox.
 */
export function createWorldMap(width: number, height: number): WorldMap {
  // world-atlas JSON has no bundled topojson types; cast through `never` for the
  // feature() call, then treat the result as GeoJSON.
  const topology = worldData as unknown as {
    objects: { countries: never };
  };
  const land = feature(
    worldData as never,
    topology.objects.countries,
  ) as unknown as GeoJSON.FeatureCollection;

  const projection = geoEqualEarth().fitSize([width, height], land as never);
  const path = geoPath(projection);
  const countryPaths = land.features
    .map((f) => path(f as never))
    .filter((d): d is string => d != null);

  return {
    width,
    height,
    countryPaths,
    project(lon, lat) {
      const point = projection([lon, lat]);
      return point ? [point[0], point[1]] : null;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- lib/peer-map.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter web check-types`
Expected: PASS (the `GeoJSON` namespace is available transitively via `@types/d3-geo`/`@types/topojson-client`).

- [ ] **Step 6: Format + commit**

```bash
pnpm --filter web exec biome format --write lib/peer-map.ts lib/peer-map.test.ts
git add apps/web/lib/peer-map.ts apps/web/lib/peer-map.test.ts
git commit -m "test(web): add createWorldMap projection helper"
```

---

### Task 5: `PeersMap` component

**Files:**
- Create: `apps/web/components/peers-map.tsx`

**Interfaces:**
- Consumes: `EnrichedPeer` from `@/lib/api`; `createWorldMap`, `groupByLocation`, `initials`, `tagColor`, `LocatedGroup` from `@/lib/peer-map`; `formatBytes`, `timeAgo` from `@/lib/format`; `cn` from `@/lib/utils`.
- Produces: `export function PeersMap({ peers }: { peers: EnrichedPeer[] })`.

- [ ] **Step 1: Create the component**

Create `apps/web/components/peers-map.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { EnrichedPeer } from "@/lib/api";
import { formatBytes, timeAgo } from "@/lib/format";
import {
  createWorldMap,
  groupByLocation,
  initials,
  type LocatedGroup,
  tagColor,
} from "@/lib/peer-map";
import { cn } from "@/lib/utils";

const WIDTH = 800;
const HEIGHT = 400;
const ONLINE = "#22c55e"; // green-500
const OFFLINE = "#94a3b8"; // slate-400

type Placed = { group: LocatedGroup; x: number; y: number };

export function PeersMap({ peers }: { peers: EnrichedPeer[] }) {
  const world = useMemo(() => createWorldMap(WIDTH, HEIGHT), []);
  const { groups, unlocated } = useMemo(() => groupByLocation(peers), [peers]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const router = useRouter();

  const placed = useMemo<Placed[]>(() => {
    const result: Placed[] = [];
    for (const group of groups) {
      const point = world.project(group.lon, group.lat);
      if (point) result.push({ group, x: point[0], y: point[1] });
    }
    return result;
  }, [groups, world]);

  const active = placed.find((p) => p.group.key === activeKey) ?? null;

  return (
    <div className="space-y-3">
      <Legend />
      <div className="relative w-full overflow-hidden rounded-lg border bg-card">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full"
          role="img"
          aria-label="Map of cluster peers and participants"
        >
          {world.countryPaths.map((d, i) => (
            <path
              key={i}
              d={d}
              className="fill-muted/40 stroke-border"
              strokeWidth={0.4}
            />
          ))}
          {placed.map(({ group, x, y }) => (
            <Pin
              key={group.key}
              group={group}
              x={x}
              y={y}
              active={group.key === activeKey}
              onActivate={() => setActiveKey(group.key)}
              onDeactivate={() =>
                setActiveKey((k) => (k === group.key ? null : k))
              }
              onOpen={() => {
                if (group.peers.length === 1) {
                  router.push(
                    `/dashboard/peers/${encodeURIComponent(group.peers[0].id)}`,
                  );
                }
              }}
            />
          ))}
        </svg>
        {active && (
          <PinCard
            group={active.group}
            leftPct={(active.x / WIDTH) * 100}
            topPct={(active.y / HEIGHT) * 100}
          />
        )}
      </div>
      {unlocated.length > 0 && <UnlocatedList peers={unlocated} />}
    </div>
  );
}

function Pin({
  group,
  x,
  y,
  active,
  onActivate,
  onDeactivate,
  onOpen,
}: {
  group: LocatedGroup;
  x: number;
  y: number;
  active: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  onOpen: () => void;
}) {
  const participant = group.peers.find((p) => p.subscribedTags.length > 0);
  const online = group.peers.some((p) => p.online);
  const ring = online ? ONLINE : OFFLINE;
  const count = group.peers.length;
  const single = count === 1;

  return (
    <g
      transform={`translate(${x}, ${y})`}
      tabIndex={0}
      role={single ? "button" : "group"}
      aria-label={pinAriaLabel(group)}
      className={cn("cursor-pointer outline-none", !online && "opacity-70")}
      onMouseEnter={onActivate}
      onMouseLeave={onDeactivate}
      onFocus={onActivate}
      onBlur={onDeactivate}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      {online && (
        <circle
          r={10}
          fill={ONLINE}
          opacity={0.35}
          className="animate-ping motion-reduce:hidden"
        />
      )}
      {participant ? (
        <>
          <circle
            r={9}
            fill={tagColor(participant.subscribedTags[0])}
            stroke={ring}
            strokeWidth={2}
          />
          <text
            textAnchor="middle"
            dy="0.32em"
            fontSize={8}
            fontWeight={600}
            fill="#fff"
            style={{ pointerEvents: "none" }}
          >
            {initials(participant.peername, participant.id)}
          </text>
        </>
      ) : (
        <rect
          x={-6}
          y={-6}
          width={12}
          height={12}
          transform="rotate(45)"
          stroke={ring}
          strokeWidth={2}
          className="fill-muted-foreground"
        />
      )}
      {count > 1 && (
        <>
          <circle cx={9} cy={-9} r={6} className="fill-foreground" />
          <text
            x={9}
            y={-9}
            textAnchor="middle"
            dy="0.32em"
            fontSize={7}
            fontWeight={700}
            className="fill-background"
            style={{ pointerEvents: "none" }}
          >
            {count}
          </text>
        </>
      )}
      {active && (
        <circle r={13} fill="none" stroke={ring} strokeWidth={1} opacity={0.6} />
      )}
    </g>
  );
}

function pinAriaLabel(group: LocatedGroup): string {
  const place = group.city || group.countryCode || "unknown location";
  if (group.peers.length === 1) {
    const p = group.peers[0];
    return `${p.peername || p.id.slice(0, 12)}, ${place}`;
  }
  return `${group.peers.length} peers in ${place}`;
}

function sinceLabel(peer: EnrichedPeer): string | null {
  const since = peer.online ? peer.onlineSince : peer.lastSeenAt;
  if (!since) return null;
  return `${peer.online ? "since " : "last seen "}${timeAgo(new Date(since))}`;
}

function PinCard({
  group,
  leftPct,
  topPct,
}: {
  group: LocatedGroup;
  leftPct: number;
  topPct: number;
}) {
  return (
    <div
      className="pointer-events-none absolute z-10 w-56 -translate-x-1/2 -translate-y-full rounded-lg border bg-popover p-3 text-popover-foreground shadow-md"
      style={{ left: `${leftPct}%`, top: `calc(${topPct}% - 12px)` }}
    >
      <p className="mb-1 text-xs font-medium text-muted-foreground">
        {group.city || group.countryCode || "Unknown location"}
      </p>
      <ul className="pointer-events-auto space-y-1.5">
        {group.peers.map((peer) => {
          const since = sinceLabel(peer);
          return (
            <li key={peer.id} className="text-sm">
              <Link
                href={`/dashboard/peers/${encodeURIComponent(peer.id)}`}
                className="font-medium hover:underline"
              >
                {peer.peername || peer.id.slice(0, 12)}
              </Link>
              <span className="ml-1.5 text-xs text-muted-foreground">
                {peer.subscribedTags.length > 0 ? "participant" : "cluster"}
                {" · "}
                {formatBytes(peer.bytesHeld)}
                {" · "}
                {peer.online ? "online" : "offline"}
              </span>
              {peer.subscribedTags.length > 0 && (
                <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
                  {peer.subscribedTags.join(", ")}
                </span>
              )}
              {since && (
                <span className="block text-[11px] text-muted-foreground">
                  {since}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block size-2.5 rotate-45 bg-muted-foreground" />
        cluster peer
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex size-3 items-center justify-center rounded-full bg-primary text-[7px] font-semibold text-primary-foreground">
          A
        </span>
        participant
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block size-2.5 rounded-full bg-[#22c55e]" />
        online
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block size-2.5 rounded-full bg-[#94a3b8]" />
        offline
      </span>
    </div>
  );
}

function UnlocatedList({ peers }: { peers: EnrichedPeer[] }) {
  return (
    <p className="text-xs text-muted-foreground">
      {peers.length} peer{peers.length === 1 ? "" : "s"} without a resolved
      location:{" "}
      {peers.map((peer, i) => (
        <span key={peer.id}>
          {i > 0 && ", "}
          <Link
            href={`/dashboard/peers/${encodeURIComponent(peer.id)}`}
            className="hover:underline"
          >
            {peer.peername || peer.id.slice(0, 12)}
          </Link>
        </span>
      ))}
    </p>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm --filter web check-types`
Expected: PASS. (No DOM test; verified by typecheck + the build in Task 6.)

- [ ] **Step 3: Format + commit**

```bash
pnpm --filter web exec biome format --write components/peers-map.tsx
git add apps/web/components/peers-map.tsx
git commit -m "feat(web): add PeersMap SVG world map with custom pins"
```

---

### Task 6: Extract table, add `PeersView` tabs, wire into the page

**Files:**
- Create: `apps/web/components/peers-table.tsx`
- Create: `apps/web/components/peers-view.tsx`
- Modify: `apps/web/app/dashboard/peers/page.tsx`

**Interfaces:**
- Consumes: `Tabs`, `TabsList`, `TabsTrigger`, `TabsPanel` (Task 1); `PeersMap` (Task 5); `EnrichedPeer` from `@/lib/api`.
- Produces: `PeersTable({ peers })`, `PeersView({ peers, locationsUpdatedAt, error })`.

- [ ] **Step 1: Create `PeersTable` (the existing table, extracted verbatim)**

Create `apps/web/components/peers-table.tsx`:

```tsx
import Link from "next/link";
import { PeerStatus } from "@/components/peer-status";
import { TagBadges } from "@/components/tag-badges";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EnrichedPeer } from "@/lib/api";
import { formatBytes } from "@/lib/format";

function flag(countryCode: string): string {
  if (countryCode.length !== 2) return "";
  return String.fromCodePoint(
    ...[...countryCode.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

export function PeersTable({ peers }: { peers: EnrichedPeer[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Peer</TableHead>
          <TableHead>Location</TableHead>
          <TableHead>IP</TableHead>
          <TableHead>Tags</TableHead>
          <TableHead className="text-right">Data held</TableHead>
          <TableHead className="text-right">Files</TableHead>
          <TableHead className="text-right">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {peers.map((peer) => (
          <TableRow
            key={peer.id}
            className={peer.online ? undefined : "opacity-60"}
          >
            <TableCell className="font-medium">
              <Link
                href={`/dashboard/peers/${encodeURIComponent(peer.id)}`}
                className="hover:underline"
              >
                {peer.peername || peer.id.slice(0, 12)}
              </Link>
            </TableCell>
            <TableCell>
              {peer.geo
                ? `${flag(peer.geo.countryCode)} ${peer.geo.city || peer.geo.country}`
                : "—"}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {peer.publicIp ?? "—"}
            </TableCell>
            <TableCell>
              <TagBadges tags={peer.subscribedTags} />
            </TableCell>
            <TableCell className="text-right">
              {formatBytes(peer.bytesHeld)}
            </TableCell>
            <TableCell className="text-right">{peer.fileCount}</TableCell>
            <TableCell className="text-right">
              <PeerStatus
                online={peer.online}
                onlineSince={peer.onlineSince}
                lastSeenAt={peer.lastSeenAt}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 2: Create `PeersView` (Card + header + tabs)**

Create `apps/web/components/peers-view.tsx`:

```tsx
"use client";

import { List, Map } from "lucide-react";
import { PeersMap } from "@/components/peers-map";
import { PeersTable } from "@/components/peers-table";
import { RefreshLocationsButton } from "@/components/refresh-locations-button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsPanel, TabsTrigger } from "@/components/ui/tabs";
import type { EnrichedPeer } from "@/lib/api";
import { timeAgo } from "@/lib/format";

export function PeersView({
  peers,
  locationsUpdatedAt,
  error,
}: {
  peers: EnrichedPeer[];
  locationsUpdatedAt: string | null;
  error: string | null;
}) {
  return (
    <Card>
      <CardContent>
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {locationsUpdatedAt
              ? `Locations updated ${timeAgo(new Date(locationsUpdatedAt))}`
              : "Locations not yet resolved"}
          </p>
          <RefreshLocationsButton />
        </div>
        {error ? (
          <p className="font-mono text-sm text-destructive">{error}</p>
        ) : peers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No peers reported yet.</p>
        ) : (
          <Tabs defaultValue="list">
            <TabsList>
              <TabsTrigger value="list">
                <List />
                List
              </TabsTrigger>
              <TabsTrigger value="map">
                <Map />
                Map
              </TabsTrigger>
            </TabsList>
            <TabsPanel value="list">
              <PeersTable peers={peers} />
            </TabsPanel>
            <TabsPanel value="map">
              <PeersMap peers={peers} />
            </TabsPanel>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Replace the page body with `PeersView`**

Replace the entire contents of `apps/web/app/dashboard/peers/page.tsx` with:

```tsx
import { PageHeader } from "@/components/page-header";
import { PeersView } from "@/components/peers-view";
import { type EnrichedPeersResult, getEnrichedPeers } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function PeersPage() {
  let peers: EnrichedPeersResult["peers"] = [];
  let locationsUpdatedAt: string | null = null;
  let error: string | null = null;
  try {
    const result = await getEnrichedPeers();
    peers = result.peers;
    locationsUpdatedAt = result.locationsUpdatedAt;
  } catch (err) {
    error = err instanceof Error ? err.message : "Cluster unreachable";
  }

  return (
    <>
      <PageHeader
        title="Peers & Followers"
        description="Cluster peers and participant followers — location, data held, and reachability."
      />
      <PeersView
        peers={peers}
        locationsUpdatedAt={locationsUpdatedAt}
        error={error}
      />
    </>
  );
}
```

- [ ] **Step 4: Typecheck + build**

Run:
```bash
pnpm --filter web check-types
pnpm --filter web build
```
Expected: both PASS. `build` succeeds without a running API because the page is `force-dynamic` (data is fetched at request time, not build time).

- [ ] **Step 5: Run the full test suite**

Run: `pnpm --filter web test`
Expected: PASS (all `lib/peer-map.test.ts` cases).

- [ ] **Step 6: Manual verification**

Start the app (`pnpm --filter web dev`) with the API/cluster reachable and open `/dashboard/peers`. Confirm:
- List/Map tabs render; List shows the unchanged table; the List tab is selected by default.
- Map tab shows the world outline, participant pins with initials + tag tint, cluster peers as diamonds, green rings/pulse for online and muted for offline.
- Hovering/focusing a pin shows the card; clicking a single-peer pin opens its detail page; co-located peers show a count badge and list all members in the card.
- Any peers without geo appear in the "N peers without a resolved location" line below the map.

- [ ] **Step 7: Format + commit**

```bash
pnpm --filter web exec biome format --write components/peers-table.tsx components/peers-view.tsx app/dashboard/peers/page.tsx
git add apps/web/components/peers-table.tsx apps/web/components/peers-view.tsx apps/web/app/dashboard/peers/page.tsx
git commit -m "feat(web): add List/Map tabs to the Peers page"
```

---

## Self-Review notes

- **Spec coverage:** Tabs (Task 1/6), self-contained SVG map (Task 4/5), role-shaped + identity pins (Task 5 `Pin`), online/offline status + pulse (Task 5), co-location grouping with count badge (Task 3 + Task 5), unlocated list (Task 5 `UnlocatedList`), hover card with peername/role/tags/data/status→detail link (Task 5 `PinCard`), legend (Task 5 `Legend`), default List tab, no URL persistence (Task 6 `defaultValue="list"`, client state), pure-helper unit tests + `vitest.config.ts` (Tasks 2–4), no API changes (page fetch unchanged, Task 6). All covered.
- **Type consistency:** `LocatedGroup`/`GroupedPeers`/`WorldMap` defined in Tasks 3–4 and consumed unchanged in Task 5; `tagColor`/`initials`/`groupByLocation`/`createWorldMap` names match across tasks; peer-detail link string identical in table, pin, card, and unlocated list.
- **No placeholders:** every code/test step contains full source and exact run commands with expected results.
```
