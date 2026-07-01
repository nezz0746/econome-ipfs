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
export async function resolveGeo(
  ip: string,
  deps: GeoDeps,
): Promise<Geo | null> {
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
