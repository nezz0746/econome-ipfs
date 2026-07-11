import { describe, expect, it, vi } from "vitest";

import { resolveSize } from "../src/pin-size";

const base = {
  setCached: vi.fn(async () => {}),
  ipfsApiUrl: "http://kubo:5001",
};

describe("resolveSize", () => {
  it("cachedOnly: returns the uploads size without hitting kubo", async () => {
    const fetchImpl = vi.fn();
    const size = await resolveSize(
      "cidA",
      {
        ...base,
        getCached: async () => null,
        uploadSize: async () => 1234,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
      { cachedOnly: true },
    );
    expect(size).toBe(1234);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("cachedOnly: returns null instead of walking the DAG when uncached", async () => {
    const fetchImpl = vi.fn();
    const size = await resolveSize(
      "cidB",
      {
        ...base,
        getCached: async () => null,
        uploadSize: async () => null,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
      { cachedOnly: true },
    );
    expect(size).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("falls back to kubo dag/stat when not cachedOnly", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ Size: 999 }), { status: 200 }),
    );
    const size = await resolveSize("cidC", {
      ...base,
      getCached: async () => null,
      uploadSize: async () => null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(size).toBe(999);
    expect(fetchImpl).toHaveBeenCalled();
  });
});
