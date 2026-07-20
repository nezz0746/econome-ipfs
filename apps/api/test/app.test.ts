import { beforeEach, describe, expect, it, vi } from "vitest";

const importMock = vi.hoisted(() => vi.fn());
vi.mock("../src/car-import", () => ({ importCidFromGateway: importMock }));

import { type AppDeps, createApp } from "../src/app";
import { hashApiKey } from "../src/auth";
import type { ClusterClient } from "../src/cluster-client";

function fakeCluster(overrides: Partial<ClusterClient> = {}): ClusterClient {
  return {
    id: vi.fn(async () => "peer-a"),
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
        metadata: {},
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
    pinStatuses: vi.fn(async () => [
      {
        cid: "bafycid",
        peers: { "peer-a": { status: "pinned", timestamp: "" } },
      },
      {
        cid: "bafy2",
        peers: { "peer-a": { status: "pinning", timestamp: "" } },
      },
    ]),
    ...overrides,
  } as unknown as ClusterClient;
}

function makeDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    cluster: fakeCluster(),
    internalToken: "tok",
    ipfsApiUrl: "http://kubo:5001",
    findApiKey: async (hashed) =>
      hashed === hashApiKey("k") ? { id: "key-1" } : undefined,
    recordUpload: vi.fn(async () => {}),
    forgetUpload: vi.fn(async () => {}),
    listTagSubscriptions: vi.fn(async () => [
      { peerId: "peer-b", subscribedTags: ["photos"] },
      { peerId: "peer-c", subscribedTags: ["videos"] },
    ]),
    peerService: {
      enrichedPeers: async () => ({ peers: [], locationsUpdatedAt: null }),
      peerDetail: async () => null,
    },
    folders: {
      create: vi.fn(async (name: string) => ({
        name,
        rootCid: "bafyroot",
        ipnsName: "k51abc",
      })),
      list: vi.fn(async () => []),
      get: vi.fn(async () => null),
      addFiles: vi.fn(async () => ({
        added: [{ path: "a.txt", cid: "bafyfile" }],
        rootCid: "bafyroot",
      })),
      addCids: vi.fn(async () => ({ rootCid: "bafyroot" })),
      movePath: vi.fn(async () => ({ rootCid: "bafyroot" })),
      removePath: vi.fn(async () => ({ rootCid: "bafyroot" })),
      setTags: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      reconcile: vi.fn(async () => ({ repinned: 0, cleaned: 0 })),
    } as unknown as AppDeps["folders"],
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

  it("adds + records on a valid key; untagged content pins to main only", async () => {
    const cluster = fakeCluster();
    const recordUpload = vi.fn(async () => {});
    const app = createApp(makeDeps({ cluster, recordUpload }));

    const form = new FormData();
    form.append("file", new File(["hello world"], "f.txt"));
    const res = await app.request("/ingest", {
      method: "POST",
      headers: { "x-api-key": "k" },
      body: form,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ cid: "bafycid", tags: [] });
    // Replication is opt-in: untagged uploads are allocated to the main peer.
    expect(cluster.add).toHaveBeenCalledWith(expect.any(FormData), {
      replicationMin: 1,
      replicationMax: 1,
      userAllocations: ["peer-a"],
    });
    expect(recordUpload).toHaveBeenCalledWith({
      cid: "bafycid",
      name: "f.txt",
      size: 11,
      tags: [],
      apiKeyId: "key-1",
    });
  });

  it("pins tagged content to the main peer + subscribers only", async () => {
    const cluster = fakeCluster();
    const recordUpload = vi.fn(async () => {});
    const app = createApp(makeDeps({ cluster, recordUpload }));

    const form = new FormData();
    form.append("file", new File(["hello world"], "f.txt"));
    form.append("tags", "Photos, archive");
    const res = await app.request("/ingest", {
      method: "POST",
      headers: { "x-api-key": "k" },
      body: form,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ tags: ["photos", "archive"] });
    // peer-b subscribes to "photos"; peer-c ("videos") is excluded.
    expect(cluster.add).toHaveBeenCalledWith(expect.any(FormData), {
      replicationMin: 1,
      replicationMax: 2,
      userAllocations: ["peer-a", "peer-b"],
      metadata: { tags: "photos,archive" },
    });
    expect(recordUpload).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["photos", "archive"] }),
    );
  });

  it("rejects invalid tags", async () => {
    const cluster = fakeCluster();
    const form = new FormData();
    form.append("file", new File(["x"], "f.txt"));
    form.append("tags", "Not A Slug!");
    const res = await createApp(makeDeps({ cluster })).request("/ingest", {
      method: "POST",
      headers: { "x-api-key": "k" },
      body: form,
    });
    expect(res.status).toBe(400);
    expect(cluster.add).not.toHaveBeenCalled();
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

  it("pins each cid to the main peer (opt-in replication) and returns per-cid results", async () => {
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
      replicationMin: 1,
      replicationMax: 1,
      userAllocations: ["peer-a"],
    });
    expect(cluster.pinByCid).toHaveBeenCalledWith("bafyc2", {
      replicationMin: 1,
      replicationMax: 1,
      userAllocations: ["peer-a"],
    });
  });

  it("pins a tagged batch with explicit allocations", async () => {
    const cluster = fakeCluster();
    const res = await createApp(makeDeps({ cluster })).request("/ingest/pin", {
      method: "POST",
      headers: { "x-api-key": "k", "content-type": "application/json" },
      body: JSON.stringify({ cids: ["bafyc1"], tags: ["videos"] }),
    });
    expect(res.status).toBe(200);
    expect(cluster.pinByCid).toHaveBeenCalledWith("bafyc1", {
      replicationMin: 1,
      replicationMax: 2,
      userAllocations: ["peer-a", "peer-c"],
      metadata: { tags: "videos" },
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

describe("POST /ingest/record", () => {
  it("rejects without an api key", async () => {
    const recordUpload = vi.fn(async () => {});
    const res = await createApp(makeDeps({ recordUpload })).request(
      "/ingest/record",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ files: [{ cid: "bafy1", size: 10 }] }),
      },
    );
    expect(res.status).toBe(401);
    expect(recordUpload).not.toHaveBeenCalled();
  });

  it("records each {cid,size} and skips invalid entries", async () => {
    const recordUpload = vi.fn(async () => {});
    const res = await createApp(makeDeps({ recordUpload })).request(
      "/ingest/record",
      {
        method: "POST",
        headers: { "x-api-key": "k", "content-type": "application/json" },
        body: JSON.stringify({
          files: [
            { cid: "bafy1", size: 10, name: "a.json" },
            { cid: "bafy2", size: 20 },
            { cid: "", size: 5 }, // invalid → skipped
            { size: 5 }, // invalid → skipped
          ],
        }),
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: 2, skipped: 2 });
    expect(recordUpload).toHaveBeenCalledWith({
      cid: "bafy1",
      name: "a.json",
      size: 10,
      tags: [],
      apiKeyId: "key-1",
    });
    expect(recordUpload).toHaveBeenCalledWith({
      cid: "bafy2",
      name: null,
      size: 20,
      tags: [],
      apiKeyId: "key-1",
    });
  });

  it("rejects an empty files array", async () => {
    const res = await createApp(makeDeps()).request("/ingest/record", {
      method: "POST",
      headers: { "x-api-key": "k", "content-type": "application/json" },
      body: JSON.stringify({ files: [] }),
    });
    expect(res.status).toBe(400);
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

  it("imports each cid, tracks it, and records it for the Files page", async () => {
    const cluster = fakeCluster();
    const recordUpload = vi.fn(async () => {});
    const res = await createApp(makeDeps({ cluster, recordUpload })).request(
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
      replicationMin: 1,
      replicationMax: 1,
      userAllocations: ["peer-a"],
    });
    // importMock returns bytes: 10 → recorded as the upload size (real DAG size).
    expect(recordUpload).toHaveBeenCalledWith({
      cid: "bafy1",
      name: null,
      size: 10,
      tags: [],
      apiKeyId: "key-1",
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
      replicationMin: 1,
      replicationMax: 1,
      userAllocations: ["peer-a"],
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

  it("summarizes pin progress from cluster statuses", async () => {
    const res = await createApp(makeDeps()).request("/cluster/pin-progress", {
      headers: { "x-internal-token": "tok" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      total: 2,
      pinned: 1,
      pinning: 1,
      queued: 0,
      error: 0,
      other: 0,
    });
  });

  it("requires the internal token for pin-progress", async () => {
    const res = await createApp(makeDeps()).request("/cluster/pin-progress");
    expect(res.status).toBe(401);
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

describe("folder routes", () => {
  it("rejects /folders without an api key", async () => {
    const res = await createApp(makeDeps()).request("/folders", {
      method: "POST",
      body: JSON.stringify({ name: "docs" }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("creates a folder via api key", async () => {
    const deps = makeDeps();
    const res = await createApp(deps).request("/folders", {
      method: "POST",
      headers: { "x-api-key": "k", "content-type": "application/json" },
      body: JSON.stringify({ name: "docs", tags: ["photos"] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: "docs",
      rootCid: "bafyroot",
      ipnsName: "k51abc",
    });
    expect(deps.folders.create).toHaveBeenCalledWith("docs", ["photos"]);
  });

  it("serves the same routes on /cluster/folders with the internal token", async () => {
    const res = await createApp(makeDeps()).request("/cluster/folders", {
      headers: { "x-internal-token": "tok" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("400s on an invalid folder name", async () => {
    const deps = makeDeps();
    (deps.folders.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("invalid folder name: ../x"),
    );
    const res = await createApp(deps).request("/folders", {
      method: "POST",
      headers: { "x-api-key": "k", "content-type": "application/json" },
      body: JSON.stringify({ name: "../x" }),
    });
    expect(res.status).toBe(400);
  });

  it("404s a missing folder on GET", async () => {
    const res = await createApp(makeDeps()).request("/folders/nope", {
      headers: { "x-api-key": "k" },
    });
    expect(res.status).toBe(404);
  });

  it("uploads files with paths, records uploads rows", async () => {
    const recordUpload = vi.fn(async () => {});
    const deps = makeDeps({ recordUpload });
    const form = new FormData();
    form.append("file", new File(["a"], "a.txt"));
    form.append("path", "sub/a.txt");
    const res = await createApp(deps).request("/folders/docs/files", {
      method: "POST",
      headers: { "x-api-key": "k" },
      body: form,
    });
    expect(res.status).toBe(200);
    expect(deps.folders.addFiles).toHaveBeenCalledWith(
      "docs",
      [expect.objectContaining({ path: "sub/a.txt" })],
      { commit: true },
    );
    // Records the relative path inside the folder, not just the basename.
    expect(recordUpload).toHaveBeenCalledWith(
      expect.objectContaining({ cid: "bafyfile", name: "docs/a.txt" }),
    );
    // (The fake addFiles returns added: [{path: "a.txt", …}]; the route must
    // build the name from the ADDED entry's path — `docs/` + added.path.)
  });

  it("honors ?commit=false on uploads", async () => {
    const deps = makeDeps();
    const form = new FormData();
    form.append("file", new File(["a"], "a.txt"));
    const res = await createApp(deps).request(
      "/folders/docs/files?commit=false",
      { method: "POST", headers: { "x-api-key": "k" }, body: form },
    );
    expect(res.status).toBe(200);
    expect(deps.folders.addFiles).toHaveBeenCalledWith(
      "docs",
      [expect.objectContaining({ path: "a.txt" })],
      { commit: false },
    );
  });

  it("moves, removes paths, patches tags, deletes the folder", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const h = { "x-api-key": "k", "content-type": "application/json" };

    expect(
      (
        await app.request("/folders/docs/move", {
          method: "POST",
          headers: h,
          body: JSON.stringify({ from: "a.txt", to: "b/a.txt" }),
        })
      ).status,
    ).toBe(200);
    expect(deps.folders.movePath).toHaveBeenCalledWith(
      "docs",
      "a.txt",
      "b/a.txt",
    );

    expect(
      (
        await app.request("/folders/docs/files?path=b%2Fa.txt", {
          method: "DELETE",
          headers: { "x-api-key": "k" },
        })
      ).status,
    ).toBe(200);
    expect(deps.folders.removePath).toHaveBeenCalledWith("docs", "b/a.txt");

    expect(
      (
        await app.request("/folders/docs", {
          method: "PATCH",
          headers: h,
          body: JSON.stringify({ tags: ["videos"] }),
        })
      ).status,
    ).toBe(200);
    expect(deps.folders.setTags).toHaveBeenCalledWith("docs", ["videos"]);

    expect(
      (
        await app.request("/folders/docs", {
          method: "DELETE",
          headers: { "x-api-key": "k" },
        })
      ).status,
    ).toBe(200);
    expect(deps.folders.remove).toHaveBeenCalledWith("docs");
  });
});

describe("docs endpoints", () => {
  it("serves the OpenAPI 3.1 spec publicly with the ApiKeyAuth scheme", async () => {
    const res = await createApp(makeDeps()).request("/openapi.json");
    expect(res.status).toBe(200);
    const spec = (await res.json()) as {
      openapi: string;
      info: { title: string };
      components?: { securitySchemes?: Record<string, unknown> };
      paths?: Record<string, unknown>;
    };
    expect(spec.openapi).toMatch(/^3\.1/);
    expect(spec.info.title).toBe("Econome Storage API");
    expect(spec.components?.securitySchemes?.ApiKeyAuth).toMatchObject({
      type: "apiKey",
      in: "header",
      name: "x-api-key",
    });
    // Internal gateway is never documented.
    for (const path of Object.keys(spec.paths ?? {})) {
      expect(path.startsWith("/cluster")).toBe(false);
    }
  });

  it("serves the Scalar UI publicly", async () => {
    const res = await createApp(makeDeps()).request("/docs");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
    expect(await res.text()).toContain("@scalar/api-reference@");
  });

  it("documents every ingest route with ApiKeyAuth", async () => {
    const res = await createApp(makeDeps()).request("/openapi.json");
    const spec = (await res.json()) as {
      paths: Record<
        string,
        Record<string, { security?: unknown; tags?: string[] }>
      >;
    };
    const expects: [string, string][] = [
      ["/ingest", "post"],
      ["/ingest/pin", "post"],
      ["/ingest/import", "post"],
      ["/ingest/record", "post"],
      ["/ingest/{cid}", "delete"],
    ];
    for (const [path, method] of expects) {
      const op = spec.paths[path]?.[method];
      expect(op, `${method.toUpperCase()} ${path}`).toBeDefined();
      expect(op?.security).toEqual([{ ApiKeyAuth: [] }]);
      expect(op?.tags).toEqual(["ingest"]);
    }
  });

  it("describes /ingest as a multipart upload", async () => {
    const res = await createApp(makeDeps()).request("/openapi.json");
    const spec = (await res.json()) as {
      paths: Record<
        string,
        { post?: { requestBody?: { content?: Record<string, unknown> } } }
      >;
    };
    expect(
      spec.paths["/ingest"]?.post?.requestBody?.content?.[
        "multipart/form-data"
      ],
    ).toBeDefined();
  });

  it("documents every folder route once, under /folders only", async () => {
    const res = await createApp(makeDeps()).request("/openapi.json");
    const spec = (await res.json()) as {
      paths: Record<
        string,
        Record<string, { security?: unknown; tags?: string[] }>
      >;
    };
    const expects: [string, string][] = [
      ["/folders", "post"],
      ["/folders", "get"],
      ["/folders/{name}", "get"],
      ["/folders/{name}", "patch"],
      ["/folders/{name}", "delete"],
      ["/folders/{name}/files", "post"],
      ["/folders/{name}/files", "delete"],
      ["/folders/{name}/cids", "post"],
      ["/folders/{name}/move", "post"],
    ];
    for (const [path, method] of expects) {
      const op = spec.paths[path]?.[method];
      expect(op, `${method.toUpperCase()} ${path}`).toBeDefined();
      expect(op?.security).toEqual([{ ApiKeyAuth: [] }]);
      expect(op?.tags).toEqual(["folders"]);
    }
    for (const path of Object.keys(spec.paths)) {
      expect(path.startsWith("/cluster")).toBe(false);
    }
    const del = spec.paths["/folders/{name}"]?.delete as
      | { responses?: Record<string, unknown> }
      | undefined;
    expect(del?.responses?.["400"]).toBeDefined();
  });
});
