"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Map as MapGL, Marker, Popup } from "react-map-gl/maplibre";
import type { EnrichedPeer } from "@/lib/api";
import { formatBytes, timeAgo } from "@/lib/format";
import {
  boundsFor,
  groupByLocation,
  initials,
  type LocatedGroup,
  tagColor,
} from "@/lib/peer-map";
import { cn } from "@/lib/utils";

const ONLINE = "#22c55e"; // green-500
const OFFLINE = "#94a3b8"; // slate-400

// Free, token-less vector styles (CARTO basemaps; OSM data, attribution shown
// by the map's attribution control).
const STYLE_LIGHT =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const STYLE_DARK =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export function PeersMap({ peers }: { peers: EnrichedPeer[] }) {
  const { resolvedTheme } = useTheme();
  const { groups, unlocated } = useMemo(() => groupByLocation(peers), [peers]);
  const bounds = useMemo(() => boundsFor(groups), [groups]);
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

  const active = groups.find((g) => g.key === activeKey) ?? null;

  // Fit the initial view to enclose every located participant; a lone pin
  // gets a country-level zoom instead of a degenerate zero-area fit.
  const initialViewState = bounds
    ? {
        bounds,
        fitBoundsOptions: { padding: 96, maxZoom: 6 },
      }
    : { longitude: 0, latitude: 25, zoom: 1 };

  return (
    <div className="space-y-3">
      <Legend />
      <div className="h-[420px] w-full overflow-hidden rounded-lg border">
        <MapGL
          // Remount when the located set changes so the fitted bounds follow.
          key={groups.map((g) => g.key).join("|") || "empty"}
          initialViewState={initialViewState}
          mapStyle={resolvedTheme === "dark" ? STYLE_DARK : STYLE_LIGHT}
          style={{ width: "100%", height: "100%" }}
          attributionControl={{ compact: true }}
        >
          {groups.map((group) => (
            <Marker
              key={group.key}
              longitude={group.lon}
              latitude={group.lat}
              anchor="center"
            >
              <Pin
                group={group}
                active={group.key === activeKey}
                onActivate={() => activate(group.key)}
                onDeactivate={() => scheduleClose(group.key)}
                onOpen={() => {
                  const only =
                    group.peers.length === 1 ? group.peers[0] : undefined;
                  if (only) {
                    router.push(
                      `/dashboard/peers/${encodeURIComponent(only.id)}`,
                    );
                  }
                }}
              />
            </Marker>
          ))}
          {active && (
            <Popup
              longitude={active.lon}
              latitude={active.lat}
              anchor="bottom"
              offset={16}
              closeButton={false}
              closeOnClick={false}
              className="peers-map-popup"
              maxWidth="240px"
            >
              <PinCard
                group={active}
                onMouseEnter={() => activate(active.key)}
                onMouseLeave={() => scheduleClose(active.key)}
              />
            </Popup>
          )}
        </MapGL>
      </div>
      {unlocated.length > 0 && <UnlocatedList peers={unlocated} />}
    </div>
  );
}

function Pin({
  group,
  active,
  onActivate,
  onDeactivate,
  onOpen,
}: {
  group: LocatedGroup;
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
    <button
      type="button"
      aria-label={pinAriaLabel(group)}
      className={cn(
        "relative block cursor-pointer outline-none",
        !online && "opacity-70",
        active && "z-10",
      )}
      onMouseEnter={onActivate}
      onMouseLeave={onDeactivate}
      onFocus={onActivate}
      onBlur={onDeactivate}
      onClick={single ? onOpen : undefined}
    >
      {online && (
        <span
          className="absolute inset-0 animate-ping rounded-full opacity-35 motion-reduce:hidden"
          style={{ backgroundColor: ONLINE }}
        />
      )}
      {participant ? (
        <span
          className="flex size-5 items-center justify-center rounded-full text-[9px] font-semibold text-white"
          style={{
            backgroundColor: tagColor(participant.subscribedTags[0] ?? ""),
            boxShadow: `0 0 0 2px ${ring}`,
          }}
        >
          {initials(participant.peername, participant.id)}
        </span>
      ) : (
        <span
          className="block size-3.5 rotate-45 bg-muted-foreground"
          style={{ boxShadow: `0 0 0 2px ${ring}` }}
        />
      )}
      {count > 1 && (
        <span className="absolute -top-2 -right-2 flex size-4 items-center justify-center rounded-full bg-foreground text-[9px] font-bold text-background">
          {count}
        </span>
      )}
    </button>
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
  onMouseEnter,
  onMouseLeave,
}: {
  group: LocatedGroup;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover bridge so the card stays reachable
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="w-56 rounded-lg border bg-popover p-3 text-popover-foreground shadow-md"
    >
      <p className="mb-1 text-xs font-medium text-muted-foreground">
        {group.city || group.countryCode || "Unknown location"}
      </p>
      <ul className="space-y-1.5">
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
