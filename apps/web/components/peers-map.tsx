"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activate = useCallback((key: string) => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setActiveKey(key);
  }, []);

  const scheduleClose = useCallback((key: string) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setActiveKey((k) => (k === key ? null : k));
      closeTimer.current = null;
    }, 150);
  }, []);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  // Groups whose coordinates don't project (never for valid lat/lon under
  // geoEqualEarth) are dropped here; geo-less peers already surface in the
  // unlocated list below.
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
        {/* biome-ignore lint/a11y/useSemanticElements: SVG map landmark grouping interactive pins — <fieldset> isn't applicable here */}
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full"
          role="group"
          aria-label="Map of cluster peers and participants"
        >
          {world.countryPaths.map((d) => (
            <path
              key={d}
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
              onActivate={() => activate(group.key)}
              onDeactivate={() => scheduleClose(group.key)}
              onOpen={() => {
                if (group.peers.length === 1) {
                  const only = group.peers[0];
                  if (only) {
                    router.push(
                      `/dashboard/peers/${encodeURIComponent(only.id)}`,
                    );
                  }
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
            onMouseEnter={() => activate(active.group.key)}
            onMouseLeave={() => scheduleClose(active.group.key)}
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
    // biome-ignore lint/a11y/noStaticElementInteractions: SVG <g> is the interactive pin — it has role, tabIndex, and keyboard/click handlers
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
            fill={tagColor(participant.subscribedTags[0] ?? "")}
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
        <circle
          r={13}
          fill="none"
          stroke={ring}
          strokeWidth={1}
          opacity={0.6}
        />
      )}
    </g>
  );
}

function pinAriaLabel(group: LocatedGroup): string {
  const place = group.city || group.countryCode || "unknown location";
  if (group.peers.length === 1) {
    const p = group.peers[0];
    return p
      ? `${p.peername || p.id.slice(0, 12)}, ${place}`
      : `peer in ${place}`;
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
  onMouseEnter,
  onMouseLeave,
}: {
  group: LocatedGroup;
  leftPct: number;
  topPct: number;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover bridge so the card stays reachable
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="pointer-events-auto absolute z-10 w-56 -translate-x-1/2 -translate-y-full rounded-lg border bg-popover p-3 text-popover-foreground shadow-md"
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
