import { describe, expect, it, vi } from "vitest";
import { type Geo, resolveGeo } from "../src/geoip";

const SAMPLE = {
  status: "success",
  country: "France",
  countryCode: "FR",
  city: "Toulouse",
  lat: 43.6,
  lon: 1.44,
};

function okFetch() {
  return vi.fn(async () => ({
    ok: true,
    json: async () => SAMPLE,
  })) as unknown as typeof fetch;
}

const cached: Geo = {
  ip: "1.2.3.4",
  countryCode: "FR",
  country: "France",
  city: "Roubaix",
  lat: 50.7,
  lon: 3.17,
};

describe("resolveGeo", () => {
  it("returns the cached value without hitting the network", async () => {
    const fetchImpl = okFetch();
    const geo = await resolveGeo("1.2.3.4", {
      getCached: async () => cached,
      setCached: async () => {},
      fetchImpl,
    });
    expect(geo).toEqual(cached);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("queries the provider and caches on a miss", async () => {
    const fetchImpl = okFetch();
    const setCached = vi.fn(async () => {});
    const geo = await resolveGeo("5.6.7.8", {
      getCached: async () => null,
      setCached,
      fetchImpl,
    });
    expect(geo?.city).toBe("Toulouse");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(setCached).toHaveBeenCalledOnce();
  });

  it("bypasses the cache and refetches when force is set", async () => {
    const fetchImpl = okFetch();
    const getCached = vi.fn(async () => cached);
    const setCached = vi.fn(async () => {});
    const geo = await resolveGeo(
      "1.2.3.4",
      { getCached, setCached, fetchImpl },
      { force: true },
    );
    expect(getCached).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(setCached).toHaveBeenCalledOnce();
    expect(geo?.city).toBe("Toulouse"); // fresh value, not the cached Roubaix
  });

  it("returns null on a provider failure", async () => {
    const geo = await resolveGeo("9.9.9.9", {
      getCached: async () => null,
      setCached: async () => {},
      fetchImpl: vi.fn(async () => ({
        ok: false,
        json: async () => ({}),
      })) as unknown as typeof fetch,
    });
    expect(geo).toBeNull();
  });
});
