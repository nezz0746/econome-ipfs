import { describe, expect, it, vi } from "vitest";

import { ClusterClient } from "../src/cluster-client";

function mockFetch(
  responses: Record<string, { status?: number; body: string }>,
) {
  return vi.fn(async (url: string | URL) => {
    const u = typeof url === "string" ? url : url.toString();
    const match = Object.keys(responses).find((path) => u.includes(path));
    const found = match ? responses[match] : undefined;
    if (!found) throw new Error(`unexpected fetch: ${u}`);
    const { status = 200, body } = found;
    return new Response(body, { status });
  }) as unknown as typeof fetch;
}

describe("ClusterClient", () => {
  it("parses /peers ndjson into typed peers", async () => {
    const fetchImpl = mockFetch({
      "/peers": {
        body:
          JSON.stringify({
            id: "peer-a",
            peername: "main",
            addresses: ["/ip4/1.2.3.4/tcp/9096"],
            ipfs: { id: "ipfs-a" },
            version: "1.0",
          }) +
          "\n" +
          JSON.stringify({
            id: "peer-b",
            peername: "follower",
            error: "unreachable",
          }),
      },
    });
    const client = new ClusterClient("http://cluster:9094", fetchImpl);

    const peers = await client.peers();

    expect(peers).toHaveLength(2);
    expect(peers[0]).toMatchObject({ id: "peer-a", ipfsId: "ipfs-a" });
    expect(peers[1]).toMatchObject({ id: "peer-b", error: "unreachable" });
  });

  it("posts to /add and returns the root cid (handling object cid)", async () => {
    const fetchImpl = mockFetch({
      "/add": {
        body: JSON.stringify({
          name: "hello.txt",
          cid: { "/": "bafyroot" },
          size: 12,
        }),
      },
    });
    const client = new ClusterClient("http://cluster:9094", fetchImpl);

    const form = new FormData();
    form.append("file", new File(["hello world"], "hello.txt"));
    const result = await client.add(form, {
      replicationMin: 1,
      replicationMax: 3,
    });

    expect(result).toEqual({ name: "hello.txt", cid: "bafyroot", size: 12 });
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const calledUrl = String(calls[0]?.[0]);
    expect(calledUrl).toContain("replication-min=1");
    expect(calledUrl).toContain("replication-max=3");
  });

  it("parses the /add JSON array form (stream-channels=false)", async () => {
    const fetchImpl = mockFetch({
      "/add": {
        body: JSON.stringify([
          {
            name: "econome-test.txt",
            cid: "QmReal",
            size: 52,
            allocations: ["peer-a", "peer-b"],
          },
        ]),
      },
    });
    const client = new ClusterClient("http://cluster:9094", fetchImpl);
    const form = new FormData();
    form.append("file", new File(["hi"], "econome-test.txt"));

    const result = await client.add(form);

    expect(result).toEqual({
      name: "econome-test.txt",
      cid: "QmReal",
      size: 52,
    });
  });

  it("parses /monitor/metrics/<name>", async () => {
    const fetchImpl = mockFetch({
      "/monitor/metrics/freespace": {
        body: JSON.stringify([
          { name: "freespace", peer: "peer-a", value: "1000", valid: true },
        ]),
      },
    });
    const client = new ClusterClient("http://cluster:9094", fetchImpl);

    const metrics = await client.metrics("freespace");

    expect(metrics[0]).toMatchObject({
      peer: "peer-a",
      value: "1000",
      valid: true,
    });
  });

  it("unpin DELETEs /pins/<cid> and tolerates 404", async () => {
    const fetchImpl = mockFetch({ "/pins/": { status: 404, body: "" } });
    const client = new ClusterClient("http://cluster:9094", fetchImpl);
    await expect(client.unpin("bafycid")).resolves.toBeUndefined();
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(String(calls[0]?.[0])).toContain("/pins/bafycid");
    expect(calls[0]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("throws on non-ok responses", async () => {
    const fetchImpl = mockFetch({ "/peers": { status: 500, body: "boom" } });
    const client = new ClusterClient("http://cluster:9094", fetchImpl);
    await expect(client.peers()).rejects.toThrow(/failed: 500/);
  });

  it("parses /pins global status into per-peer status + timestamp", async () => {
    const fetchImpl = mockFetch({
      "/pins": {
        body: `${JSON.stringify({
          cid: { "/": "bafyc1" },
          peer_map: {
            "peer-a": { status: "pinned", timestamp: "2026-06-30T10:00:00Z" },
            "peer-b": {
              status: "pinning",
              timestamp: "2026-06-30T10:05:00Z",
            },
          },
        })}\n`,
      },
    });
    const client = new ClusterClient("http://cluster:9094", fetchImpl);

    const statuses = await client.pinStatuses();

    expect(statuses).toHaveLength(1);
    const first = statuses[0];
    expect(first?.cid).toBe("bafyc1");
    expect(first?.peers["peer-a"]).toEqual({
      status: "pinned",
      timestamp: "2026-06-30T10:00:00Z",
    });
    expect(first?.peers["peer-b"]?.status).toBe("pinning");
  });
});
