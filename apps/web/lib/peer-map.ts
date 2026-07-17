import type { EnrichedPeer } from "@/lib/api";

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
