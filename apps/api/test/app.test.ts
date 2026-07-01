import { describe, expect, it, vi } from "vitest";

import { type AppDeps, createApp } from "../src/app";
import { hashApiKey } from "../src/auth";
import type { ClusterClient } from "../src/cluster-client";

function fakeCluster(overrides: Partial<ClusterClient> = {}): ClusterClient {
  return {
    add: vi.fn(async () => ({ name: "f.txt", cid: "bafycid", size: 11 })),
    peers: vi.fn(async () => [
      { id: "peer-a", peername: "main", addresses: [], error: undefined },
      { id: "peer-b", peername: "follower", addresses: [], error: "down" },
    ]),
    pins: vi.fn(async () => [
      {
        cid: "bafycid",
        name: "f.txt",
        allocations: ["peer-a"],
        replicationFactorMin: 2,
        replicationFactorMax: 3,
      },
    ]),
    healthGraph: vi.fn(async () => ({
      clusterId: "peer-a",
      clusterPeers: ["peer-a", "peer-b"],
      clusterLinks: {},
      ipfsLinks: {},
    })),
    metrics: vi.fn(async () => []),
    unpin: vi.fn(async () => {}),
    ...overrides,
  } as unknown as ClusterClient;
}

function makeDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    cluster: fakeCluster(),
    internalToken: "tok",
    replication: { min: 2, max: 3 },
    findApiKey: async (hashed) =>
      hashed === hashApiKey("k") ? { id: "key-1" } : undefined,
    recordUpload: vi.fn(async () => {}),
    forgetUpload: vi.fn(async () => {}),
    peerService: {
      enrichedPeers: async () => [],
      peerDetail: async () => null,
    },
    ...overrides,
  };
}

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await createApp(makeDeps()).request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("POST /ingest", () => {
  it("rejects without an api key and does not call the cluster", async () => {
    const cluster = fakeCluster();
    const res = await createApp(makeDeps({ cluster })).request("/ingest", {
      method: "POST",
    });
    expect(res.status).toBe(401);
    expect(cluster.add).not.toHaveBeenCalled();
  });

  it("adds + records on a valid key", async () => {
    const recordUpload = vi.fn(async () => {});
    const app = createApp(makeDeps({ recordUpload }));

    const form = new FormData();
    form.append("file", new File(["hello world"], "f.txt"));
    const res = await app.request("/ingest", {
      method: "POST",
      headers: { "x-api-key": "k" },
      body: form,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ cid: "bafycid" });
    expect(recordUpload).toHaveBeenCalledWith({
      cid: "bafycid",
      name: "f.txt",
      size: 11,
      apiKeyId: "key-1",
    });
  });
});

describe("DELETE /ingest/:cid", () => {
  it("rejects without an api key", async () => {
    const cluster = fakeCluster();
    const res = await createApp(makeDeps({ cluster })).request(
      "/ingest/bafycid",
      { method: "DELETE" },
    );
    expect(res.status).toBe(401);
    expect(cluster.unpin).not.toHaveBeenCalled();
  });

  it("unpins and forgets the cid on a valid key", async () => {
    const cluster = fakeCluster();
    const forgetUpload = vi.fn(async () => {});
    const res = await createApp(makeDeps({ cluster, forgetUpload })).request(
      "/ingest/bafycid",
      { method: "DELETE", headers: { "x-api-key": "k" } },
    );
    expect(res.status).toBe(200);
    expect(cluster.unpin).toHaveBeenCalledWith("bafycid");
    expect(forgetUpload).toHaveBeenCalledWith("bafycid");
  });
});

describe("cluster gateway", () => {
  it("requires the internal token", async () => {
    const res = await createApp(makeDeps()).request("/cluster/peers");
    expect(res.status).toBe(401);
  });

  it("returns peers with the internal token", async () => {
    const res = await createApp(makeDeps()).request("/cluster/peers", {
      headers: { "x-internal-token": "tok" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(2);
  });

  it("computes overview (under-replicated counts)", async () => {
    const res = await createApp(makeDeps()).request("/cluster/overview", {
      headers: { "x-internal-token": "tok" },
    });
    expect(await res.json()).toEqual({
      peerCount: 2,
      onlinePeers: 1,
      totalPins: 1,
      underReplicated: 1,
    });
  });
});
