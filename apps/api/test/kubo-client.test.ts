import { describe, expect, it, vi } from "vitest";

import { KuboClient } from "../src/kubo-client";

/** fetch stub that records calls and replies with the given JSON per call. */
function fakeFetch(...replies: unknown[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let i = 0;
  const impl = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const body = replies[Math.min(i++, replies.length - 1)];
      return new Response(JSON.stringify(body ?? {}), { status: 200 });
    },
  );
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("KuboClient", () => {
  it("filesMkdir POSTs with parents=true", async () => {
    const { impl, calls } = fakeFetch({});
    await new KuboClient("http://kubo:5001", impl).filesMkdir("/econome/docs");
    const call = calls[0];
    expect(call).toBeDefined();
    const url = new URL(call?.url ?? "");
    expect(url.pathname).toBe("/api/v0/files/mkdir");
    expect(url.searchParams.get("arg")).toBe("/econome/docs");
    expect(url.searchParams.get("parents")).toBe("true");
    expect(call?.init?.method).toBe("POST");
  });

  it("filesLs maps entries and empty dirs (null Entries)", async () => {
    const { impl } = fakeFetch({
      Entries: [
        { Name: "a.txt", Type: 0, Size: 11, Hash: "bafyfile" },
        { Name: "sub", Type: 1, Size: 0, Hash: "bafydir" },
      ],
    });
    const client = new KuboClient("http://kubo:5001", impl);
    expect(await client.filesLs("/econome/docs")).toEqual([
      { name: "a.txt", type: "file", size: 11, cid: "bafyfile" },
      { name: "sub", type: "dir", size: 0, cid: "bafydir" },
    ]);

    const empty = fakeFetch({ Entries: null });
    expect(
      await new KuboClient("http://kubo:5001", empty.impl).filesLs("/x"),
    ).toEqual([]);
  });

  it("filesStat maps kubo fields", async () => {
    const { impl } = fakeFetch({
      Hash: "bafyroot",
      Size: 0,
      CumulativeSize: 123,
      Blocks: 2,
      Type: "directory",
    });
    expect(
      await new KuboClient("http://kubo:5001", impl).filesStat("/econome/docs"),
    ).toEqual({
      cid: "bafyroot",
      size: 0,
      cumulativeSize: 123,
      type: "dir",
      blocks: 2,
    });
  });

  it("filesFlush returns the flushed root CID", async () => {
    const { impl } = fakeFetch({ Cid: "bafyroot" });
    expect(
      await new KuboClient("http://kubo:5001", impl).filesFlush(
        "/econome/docs",
      ),
    ).toBe("bafyroot");
  });

  it("filesCp sends both args and parents=true", async () => {
    const { impl, calls } = fakeFetch({});
    await new KuboClient("http://kubo:5001", impl).filesCp(
      "/ipfs/bafyfile",
      "/econome/docs/a.txt",
    );
    const url = new URL(calls[0]?.url ?? "");
    expect(url.searchParams.getAll("arg")).toEqual([
      "/ipfs/bafyfile",
      "/econome/docs/a.txt",
    ]);
    expect(url.searchParams.get("parents")).toBe("true");
  });

  it("filesRm sends recursive+force", async () => {
    const { impl, calls } = fakeFetch({});
    await new KuboClient("http://kubo:5001", impl).filesRm("/econome/docs/a");
    const url = new URL(calls[0]?.url ?? "");
    expect(url.searchParams.get("recursive")).toBe("true");
    expect(url.searchParams.get("force")).toBe("true");
  });

  it("addFile posts multipart with pin=false and returns the CID", async () => {
    const { impl, calls } = fakeFetch({
      Name: "a.txt",
      Hash: "bafyfile",
      Size: "11",
    });
    const cid = await new KuboClient("http://kubo:5001", impl).addFile(
      new Blob(["hello world"]),
      "a.txt",
    );
    expect(cid).toBe("bafyfile");
    const url = new URL(calls[0]?.url ?? "");
    expect(url.pathname).toBe("/api/v0/add");
    expect(url.searchParams.get("pin")).toBe("false");
    expect(url.searchParams.get("cid-version")).toBe("1");
    expect(calls[0]?.init?.body).toBeInstanceOf(FormData);
  });

  it("keyGen/keyList use ed25519 + base36 ids", async () => {
    const gen = fakeFetch({ Name: "econome-folder-docs", Id: "k51abc" });
    const key = await new KuboClient("http://kubo:5001", gen.impl).keyGen(
      "econome-folder-docs",
    );
    expect(key).toEqual({ name: "econome-folder-docs", id: "k51abc" });
    const genUrl = new URL(gen.calls[0]?.url ?? "");
    expect(genUrl.searchParams.get("type")).toBe("ed25519");
    expect(genUrl.searchParams.get("ipns-base")).toBe("base36");

    const list = fakeFetch({
      Keys: [
        { Name: "self", Id: "k51self" },
        { Name: "econome-folder-docs", Id: "k51abc" },
      ],
    });
    expect(
      await new KuboClient("http://kubo:5001", list.impl).keyList(),
    ).toEqual([
      { name: "self", id: "k51self" },
      { name: "econome-folder-docs", id: "k51abc" },
    ]);
  });

  it("namePublish targets the key with lifetime + allow-offline", async () => {
    const { impl, calls } = fakeFetch({
      Name: "k51abc",
      Value: "/ipfs/bafyroot",
    });
    await new KuboClient("http://kubo:5001", impl).namePublish(
      "econome-folder-docs",
      "/ipfs/bafyroot",
    );
    const url = new URL(calls[0]?.url ?? "");
    expect(url.pathname).toBe("/api/v0/name/publish");
    expect(url.searchParams.get("arg")).toBe("/ipfs/bafyroot");
    expect(url.searchParams.get("key")).toBe("econome-folder-docs");
    expect(url.searchParams.get("lifetime")).toBe("168h");
    expect(url.searchParams.get("allow-offline")).toBe("true");
  });

  it("throws with status + body excerpt on kubo errors", async () => {
    const impl = vi.fn(
      async () =>
        new Response(JSON.stringify({ Message: "file does not exist" }), {
          status: 500,
        }),
    ) as unknown as typeof fetch;
    await expect(
      new KuboClient("http://kubo:5001", impl).filesStat("/nope"),
    ).rejects.toThrow(/files\/stat failed: 500.*does not exist/);
  });
});
