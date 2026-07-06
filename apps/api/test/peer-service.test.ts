import { describe, expect, it, vi } from "vitest";

import type { ClusterClient } from "../src/cluster-client";
import type { Geo } from "../src/geoip";
import { createPeerService, type PeerServiceDeps } from "../src/peer-service";

const CACHED: Geo = {
  ip: "90.1.2.3",
  countryCode: "FR",
  country: "France",
  city: "Roubaix",
  lat: 50.7,
  lon: 3.17,
};

const FRESH = { ...CACHED, city: "Toulouse", lat: 43.6, lon: 1.44 };
const UPDATED_AT = new Date("2026-07-06T12:00:00Z");

function makeDeps(overrides: Partial<PeerServiceDeps> = {}): {
  deps: PeerServiceDeps;
  geoGet: ReturnType<typeof vi.fn>;
  geoSet: ReturnType<typeof vi.fn>;
  fetchImpl: ReturnType<typeof vi.fn>;
} {
  const geoGet = vi.fn(async () => CACHED);
  const geoSet = vi.fn(async () => {});
  const fetchImpl = vi.fn(async () => ({
    ok: true,
    json: async () => ({ status: "success", ...FRESH }),
  }));

  const cluster = {
    peers: vi.fn(async () => [
      {
        id: "peer-a",
        peername: "main",
        addresses: ["/ip4/90.1.2.3/tcp/4001"],
        error: undefined,
      },
    ]),
    pins: vi.fn(async () => []),
    pinStatuses: vi.fn(async () => []),
  } as unknown as ClusterClient;

  const deps: PeerServiceDeps = {
    cluster,
    ipfsApiUrl: "http://kubo:5001",
    geo: {
      get: geoGet,
      set: geoSet,
      latestFetchedAt: async () => UPDATED_AT,
    },
    pinSize: {
      get: async () => null,
      set: async () => {},
      uploadSize: async () => null,
    },
    readParticipants: async () => [],
    readSnapshots: async () => [],
    readLastSnapshots: async () => [],
    readLastOffline: async () => [],
    fetchImpl: fetchImpl as unknown as typeof fetch,
    ...overrides,
  };
  return { deps, geoGet, geoSet, fetchImpl };
}

describe("createPeerService.enrichedPeers", () => {
  it("uses the geo cache and reports locationsUpdatedAt on a normal load", async () => {
    const { deps, geoGet, fetchImpl } = makeDeps();
    const result = await createPeerService(deps).enrichedPeers();

    expect(geoGet).toHaveBeenCalledWith("90.1.2.3");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.peers[0]?.geo?.city).toBe("Roubaix");
    expect(result.locationsUpdatedAt).toEqual(UPDATED_AT);
  });

  it("bypasses the cache and refetches when force is set", async () => {
    const { deps, geoGet, geoSet, fetchImpl } = makeDeps();
    const result = await createPeerService(deps).enrichedPeers({ force: true });

    expect(geoGet).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(geoSet).toHaveBeenCalledOnce();
    expect(result.peers[0]?.geo?.city).toBe("Toulouse");
  });
});
