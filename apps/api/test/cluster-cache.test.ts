import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cacheClusterReads } from "../src/cluster-cache";
import type { ClusterClient } from "../src/cluster-client";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function fakeCluster() {
  return {
    peers: vi.fn(async () => [{ id: "peer-a" }]),
    pins: vi.fn(async () => [{ cid: "c1" }]),
    pinStatuses: vi.fn(async () => [{ cid: "c1", peers: {} }]),
    id: vi.fn(async () => "peer-a"),
    pinByCid: vi.fn(async () => {}),
  } as unknown as ClusterClient;
}

describe("cacheClusterReads", () => {
  it("serves reads from cache within the TTL, refetches after", async () => {
    const base = fakeCluster();
    const cached = cacheClusterReads(base, 15_000);

    await cached.pinStatuses();
    await cached.pinStatuses();
    expect(base.pinStatuses).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(15_001);
    await cached.pinStatuses();
    expect(base.pinStatuses).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight fetch across concurrent callers", async () => {
    const base = fakeCluster();
    const cached = cacheClusterReads(base, 15_000);
    await Promise.all([cached.peers(), cached.peers(), cached.peers()]);
    expect(base.peers).toHaveBeenCalledTimes(1);
  });

  it("does not cache rejections", async () => {
    const base = fakeCluster();
    (base.pins as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([{ cid: "c1" }]);
    const cached = cacheClusterReads(base, 15_000);

    await expect(cached.pins()).rejects.toThrow("boom");
    await expect(cached.pins()).resolves.toEqual([{ cid: "c1" }]);
    expect(base.pins).toHaveBeenCalledTimes(2);
  });

  it("passes writes and identity through uncached", async () => {
    const base = fakeCluster();
    const cached = cacheClusterReads(base, 15_000);
    await cached.id();
    await cached.id();
    await cached.pinByCid("c1", {});
    expect(base.id).toHaveBeenCalledTimes(2);
    expect(base.pinByCid).toHaveBeenCalledWith("c1", {});
  });
});
