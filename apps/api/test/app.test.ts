import { beforeEach, describe, expect, it, vi } from "vitest";

const importMock = vi.hoisted(() => vi.fn());
vi.mock("../src/car-import", () => ({ importCidFromGateway: importMock }));

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
    pinByCid: vi.fn(async () => {}),
    ...overrides,
  } as unknown as ClusterClient;
}

function makeDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    cluster: fakeCluster(),
    internalToken: "tok",
    replication: { min: 2, max: 3 },
    ipfsApiUrl: "http://kubo:5001",
    findApiKey: async (hashed) =>
      hashed === hashApiKey("k") ? { id: "key-1" } : undefined,
    recordUpload: vi.fn(async () => {}),
    forgetUpload: vi.fn(async () => {}),
    peerService: {
      enrichedPeers: async () => ({ peers: [], locationsUpdatedAt: null }),
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

describe("POST /ingest/pin", () => {
  it("rejects without an api key and does not touch the cluster", async () => {
    const cluster = fakeCluster();
    const res = await createApp(makeDeps({ cluster })).request("/ingest/pin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cids: ["bafyc1"] }),
    });
    expect(res.status).toBe(401);
    expect(cluster.pinByCid).not.toHaveBeenCalled();
  });

  it("pins each cid with the configured replication and returns per-cid results", async () => {
    const cluster = fakeCluster();
    const res = await createApp(makeDeps({ cluster })).request("/ingest/pin", {
      method: "POST",
      headers: { "x-api-key": "k", "content-type": "application/json" },
      body: JSON.stringify({ cids: ["bafyc1", "bafyc2"] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      pinned: 2,
      failed: 0,
      results: [
        { cid: "bafyc1", ok: true },
        { cid: "bafyc2", ok: true },
      ],
    });
    expect(cluster.pinByCid).toHaveBeenCalledWith("bafyc1", {
      replicationMin: 2,
      replicationMax: 3,
    });
    expect(cluster.pinByCid).toHaveBeenCalledWith("bafyc2", {
      replicationMin: 2,
      replicationMax: 3,
    });
  });

  it("reports per-cid failures without failing the whole batch", async () => {
    const cluster = fakeCluster({
      pinByCid: vi.fn(async (cid: string) => {
        if (cid === "bad") throw new Error("nope");
      }),
    });
    const res = await createApp(makeDeps({ cluster })).request("/ingest/pin", {
      method: "POST",
      headers: { "x-api-key": "k", "content-type": "application/json" },
      body: JSON.stringify({ cids: ["bafyc1", "bad"] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pinned: number;
      failed: number;
      results: { cid: string; ok: boolean; error?: string }[];
    };
    expect(body.pinned).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.results).toContainEqual({
      cid: "bad",
      ok: false,
      error: "nope",
    });
  });

  it("rejects an empty cids array", async () => {
    const cluster = fakeCluster();
    const res = await createApp(makeDeps({ cluster })).request("/ingest/pin", {
      method: "POST",
      headers: { "x-api-key": "k", "content-type": "application/json" },
      body: JSON.stringify({ cids: [] }),
    });
    expect(res.status).toBe(400);
    expect(cluster.pinByCid).not.toHaveBeenCalled();
  });
});

describe("POST /ingest/import", () => {
  beforeEach(() => {
    importMock.mockReset();
    importMock.mockImplementation(async (cid: string) => ({
      cid,
      ok: true,
      blocks: 1,
      bytes: 10,
    }));
  });

  it("rejects without an api key and does no work", async () => {
    const cluster = fakeCluster();
    const res = await createApp(makeDeps({ cluster })).request(
      "/ingest/import",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cids: ["bafy1"] }),
      },
    );
    expect(res.status).toBe(401);
    expect(importMock).not.toHaveBeenCalled();
    expect(cluster.pinByCid).not.toHaveBeenCalled();
  });

  it("imports each cid (default gateway) and tracks it in the cluster", async () => {
    const cluster = fakeCluster();
    const res = await createApp(makeDeps({ cluster })).request(
      "/ingest/import",
      {
        method: "POST",
        headers: { "x-api-key": "k", "content-type": "application/json" },
        body: JSON.stringify({ cids: ["bafy1", "bafy2"] }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { imported: number; failed: number };
    expect(body).toMatchObject({ imported: 2, failed: 0 });
    expect(importMock).toHaveBeenCalledWith("bafy1", {
      gateway: "https://gateway.pinata.cloud",
      ipfsApiUrl: "http://kubo:5001",
    });
    expect(cluster.pinByCid).toHaveBeenCalledWith("bafy1", {
      replicationMin: 2,
      replicationMax: 3,
    });
  });

  it("passes a custom gateway through to the importer", async () => {
    await createApp(makeDeps()).request("/ingest/import", {
      method: "POST",
      headers: { "x-api-key": "k", "content-type": "application/json" },
      body: JSON.stringify({ cids: ["bafy1"], gateway: "https://my.gw" }),
    });
    expect(importMock).toHaveBeenCalledWith("bafy1", {
      gateway: "https://my.gw",
      ipfsApiUrl: "http://kubo:5001",
    });
  });

  it("reports a failed import and does not pin it", async () => {
    importMock.mockImplementation(async (cid: string) =>
      cid === "bad"
        ? { cid, ok: false, error: "cid_mismatch (imported none)" }
        : { cid, ok: true },
    );
    const cluster = fakeCluster();
    const res = await createApp(makeDeps({ cluster })).request(
      "/ingest/import",
      {
        method: "POST",
        headers: { "x-api-key": "k", "content-type": "application/json" },
        body: JSON.stringify({ cids: ["bafy1", "bad"] }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      imported: number;
      failed: number;
      results: { cid: string; ok: boolean; error?: string }[];
    };
    expect(body.imported).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.results).toContainEqual({
      cid: "bad",
      ok: false,
      error: "cid_mismatch (imported none)",
    });
    expect(cluster.pinByCid).toHaveBeenCalledWith("bafy1", {
      replicationMin: 2,
      replicationMax: 3,
    });
    expect(cluster.pinByCid).not.toHaveBeenCalledWith("bad", expect.anything());
  });

  it("rejects an empty cids array", async () => {
    const res = await createApp(makeDeps()).request("/ingest/import", {
      method: "POST",
      headers: { "x-api-key": "k", "content-type": "application/json" },
      body: JSON.stringify({ cids: [] }),
    });
    expect(res.status).toBe(400);
    expect(importMock).not.toHaveBeenCalled();
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
