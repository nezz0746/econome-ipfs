import { describe, expect, it, vi } from "vitest";

import type { PinInfo } from "../src/cluster-client";
import {
  FolderService,
  isValidFolderName,
  isValidRelPath,
} from "../src/folder-service";
import type { KuboClient } from "../src/kubo-client";

/** Call-order-recording fakes: every stub pushes its op onto `ops`. */
function makeFakes(opts: { pins?: PinInfo[]; root?: string } = {}) {
  const ops: string[] = [];
  const kubo = {
    filesMkdir: vi.fn(async (p: string) => void ops.push(`mkdir:${p}`)),
    filesLs: vi.fn(async () => []),
    filesStat: vi.fn(async () => ({
      cid: opts.root ?? "bafyroot",
      size: 0,
      cumulativeSize: 42,
      type: "dir" as const,
      blocks: 1,
    })),
    filesCp: vi.fn(
      async (f: string, t: string) => void ops.push(`cp:${f}->${t}`),
    ),
    filesMv: vi.fn(async () => {}),
    filesRm: vi.fn(async (p: string) => void ops.push(`rm:${p}`)),
    filesFlush: vi.fn(async () => {
      ops.push("flush");
      return opts.root ?? "bafyroot";
    }),
    addFile: vi.fn(async () => "bafyfile"),
    keyGen: vi.fn(async (name: string) => {
      ops.push(`keygen:${name}`);
      return { name, id: "k51abc" };
    }),
    keyList: vi.fn(async () => [{ name: "econome-folder-docs", id: "k51abc" }]),
    keyRm: vi.fn(async (name: string) => void ops.push(`keyrm:${name}`)),
    namePublish: vi.fn(
      async (key: string, path: string) =>
        void ops.push(`publish:${key}:${path}`),
    ),
  } as unknown as KuboClient;

  const cluster = {
    pins: vi.fn(async () => opts.pins ?? []),
    pinByCid: vi.fn(async (cid: string) => void ops.push(`pin:${cid}`)),
    unpin: vi.fn(async (cid: string) => void ops.push(`unpin:${cid}`)),
  };

  const service = new FolderService({
    kubo,
    cluster,
    getMainPeerId: async () => "peer-a",
    listTagSubscriptions: async () => [
      { peerId: "peer-b", subscribedTags: ["photos"] },
    ],
  });
  return { service, kubo, cluster, ops };
}

function folderPin(over: Partial<PinInfo> = {}): PinInfo {
  return {
    cid: "bafyold",
    name: "folder:docs",
    allocations: ["peer-a"],
    replicationFactorMin: 1,
    replicationFactorMax: 1,
    metadata: { folder: "docs", tags: "photos" },
    ...over,
  };
}

describe("validation", () => {
  it("accepts slugs, rejects path-dangerous names", () => {
    expect(isValidFolderName("docs")).toBe(true);
    expect(isValidFolderName("my-folder-2")).toBe(true);
    expect(isValidFolderName("")).toBe(false);
    expect(isValidFolderName("../etc")).toBe(false);
    expect(isValidFolderName("Has Space")).toBe(false);
  });

  it("accepts nested relative paths, rejects traversal/absolute", () => {
    expect(isValidRelPath("a.txt")).toBe(true);
    expect(isValidRelPath("sub/dir/a.txt")).toBe(true);
    expect(isValidRelPath("")).toBe(false);
    expect(isValidRelPath("/abs")).toBe(false);
    expect(isValidRelPath("a/../b")).toBe(false);
    expect(isValidRelPath("a//b")).toBe(false);
    expect(isValidRelPath("a\\b")).toBe(false);
  });
});

describe("create", () => {
  it("mkdirs, generates the key, pins the root, publishes", async () => {
    const { service, ops } = makeFakes();
    const res = await service.create("docs", ["photos"]);
    expect(res).toEqual({
      name: "docs",
      rootCid: "bafyroot",
      ipnsName: "k51abc",
    });
    expect(ops).toEqual([
      "mkdir:/econome/docs",
      "keygen:econome-folder-docs",
      "flush",
      "pin:bafyroot",
      "publish:econome-folder-docs:/ipfs/bafyroot",
    ]);
  });

  it("is idempotent when the key already exists", async () => {
    const { service, kubo } = makeFakes();
    (kubo.keyGen as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error(
        "kubo key/gen failed: 500 key with name 'econome-folder-docs' already exists",
      ),
    );
    const res = await service.create("docs", []);
    expect(res.ipnsName).toBe("k51abc"); // recovered via keyList
  });

  it("rejects invalid names", async () => {
    const { service } = makeFakes();
    await expect(service.create("../x", [])).rejects.toThrow(
      /invalid folder name/,
    );
  });
});

describe("commit ordering (via create over an existing stale pin)", () => {
  it("pins the new root BEFORE unpinning stale roots and publishes in between", async () => {
    const { service, ops } = makeFakes({
      pins: [folderPin({ cid: "bafyold" })],
      root: "bafynew",
    });
    await service.create("docs", ["photos"]);
    const pinIdx = ops.indexOf("pin:bafynew");
    const pubIdx = ops.indexOf("publish:econome-folder-docs:/ipfs/bafynew");
    const unpinIdx = ops.indexOf("unpin:bafyold");
    expect(pinIdx).toBeGreaterThan(-1);
    expect(pubIdx).toBeGreaterThan(pinIdx);
    expect(unpinIdx).toBeGreaterThan(pubIdx);
  });

  it("skips re-pinning when the root is already pinned", async () => {
    const { service, cluster } = makeFakes({
      pins: [folderPin({ cid: "bafyroot" })],
      root: "bafyroot",
    });
    await service.create("docs", ["photos"]);
    expect(cluster.pinByCid).not.toHaveBeenCalled();
  });
});

describe("list / get", () => {
  it("lists folders with root, ipns name, size and tags", async () => {
    const { service, kubo } = makeFakes({
      pins: [folderPin({ cid: "bafyroot" })],
    });
    (kubo.filesLs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { name: "docs", type: "dir", size: 0, cid: "bafyroot" },
    ]);
    expect(await service.list()).toEqual([
      {
        name: "docs",
        rootCid: "bafyroot",
        ipnsName: "k51abc",
        size: 42,
        tags: ["photos"],
      },
    ]);
  });

  it("returns [] when /econome does not exist yet", async () => {
    const { service, kubo } = makeFakes();
    (kubo.filesLs as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("kubo files/ls failed: 500 file does not exist"),
    );
    expect(await service.list()).toEqual([]);
  });

  it("gets a folder subtree at a path", async () => {
    const { service, kubo } = makeFakes({
      pins: [folderPin({ cid: "bafyroot" })],
    });
    (kubo.filesLs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { name: "a.txt", type: "file", size: 11, cid: "bafyfile" },
    ]);
    const detail = await service.get("docs", "sub");
    expect(detail).toMatchObject({
      name: "docs",
      rootCid: "bafyroot",
      path: "sub",
      entries: [{ name: "a.txt", type: "file", size: 11, cid: "bafyfile" }],
    });
    expect(kubo.filesLs).toHaveBeenCalledWith("/econome/docs/sub");
  });

  it("returns null for a missing folder", async () => {
    const { service, kubo } = makeFakes();
    (kubo.filesStat as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("kubo files/stat failed: 500 file does not exist"),
    );
    expect(await service.get("nope")).toBeNull();
  });

  it("propagates cluster errors instead of returning null", async () => {
    const { service, cluster } = makeFakes();
    (cluster.pins as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Cluster /allocations failed: 404 Not Found"),
    );
    await expect(service.get("docs")).rejects.toThrow(/Cluster/);
  });

  it("returns null when the subpath is missing", async () => {
    const { service, kubo } = makeFakes();
    (kubo.filesLs as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("kubo files/ls failed: 500 file does not exist"),
    );
    expect(await service.get("docs", "nope")).toBeNull();
  });
});

describe("mutations", () => {
  it("addFiles adds unpinned bytes, cps into place, commits once", async () => {
    const { service, kubo, ops } = makeFakes({
      pins: [folderPin({ cid: "bafyroot" })],
    });
    const res = await service.addFiles("docs", [
      { content: new Blob(["a"]), path: "a.txt" },
      { content: new Blob(["b"]), path: "sub/b.txt" },
    ]);
    expect(res.added).toEqual([
      { path: "a.txt", cid: "bafyfile" },
      { path: "sub/b.txt", cid: "bafyfile" },
    ]);
    expect(res.rootCid).toBe("bafyroot");
    expect(kubo.addFile).toHaveBeenCalledTimes(2);
    expect(ops.filter((o) => o === "flush")).toHaveLength(1); // one commit
    expect(ops).toContain("cp:/ipfs/bafyfile->/econome/docs/sub/b.txt");
  });

  it("addFiles with commit:false stages without flushing", async () => {
    const { service, ops } = makeFakes();
    const res = await service.addFiles(
      "docs",
      [{ content: new Blob(["a"]), path: "a.txt" }],
      { commit: false },
    );
    expect(res.rootCid).toBeNull();
    expect(ops).not.toContain("flush");
  });

  it("addFiles rejects traversal paths", async () => {
    const { service } = makeFakes();
    await expect(
      service.addFiles("docs", [{ content: new Blob(["x"]), path: "../x" }]),
    ).rejects.toThrow(/invalid path/);
  });

  it("addCids mounts existing CIDs and commits", async () => {
    const { service, ops } = makeFakes();
    await service.addCids("docs", [{ cid: "bafyext", path: "ext.bin" }]);
    expect(ops).toContain("cp:/ipfs/bafyext->/econome/docs/ext.bin");
    expect(ops).toContain("flush");
  });

  it("movePath and removePath commit after mutating", async () => {
    const { service, kubo, ops } = makeFakes();
    await service.movePath("docs", "a.txt", "sub/a.txt");
    expect(kubo.filesMv).toHaveBeenCalledWith(
      "/econome/docs/a.txt",
      "/econome/docs/sub/a.txt",
    );
    await service.removePath("docs", "sub/a.txt");
    expect(ops).toContain("rm:/econome/docs/sub/a.txt");
    expect(ops.filter((o) => o === "flush")).toHaveLength(2);
  });

  it("setTags re-pins the current root with new metadata, no publish", async () => {
    const { service, cluster, kubo } = makeFakes({
      pins: [folderPin({ cid: "bafyroot" })],
    });
    await service.setTags("docs", ["videos"]);
    expect(cluster.pinByCid).toHaveBeenCalledWith(
      "bafyroot",
      expect.objectContaining({
        metadata: { tags: "videos", folder: "docs" },
      }),
    );
    expect(kubo.namePublish).not.toHaveBeenCalled();
  });

  it("remove unpins every folder root, removes the dir and the key", async () => {
    const { service, ops } = makeFakes({
      pins: [folderPin({ cid: "bafyold" }), folderPin({ cid: "bafyroot" })],
    });
    await service.remove("docs");
    expect(ops).toContain("unpin:bafyold");
    expect(ops).toContain("unpin:bafyroot");
    expect(ops).toContain("rm:/econome/docs");
    expect(ops).toContain("keyrm:econome-folder-docs");
  });

  it("serializes concurrent mutations on the same folder", async () => {
    const { service, kubo, ops } = makeFakes();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    (kubo.addFile as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async () => {
        await gate;
        return "bafyfile";
      },
    );
    const first = service.addFiles("docs", [
      { content: new Blob(["a"]), path: "a.txt" },
    ]);
    const second = service.removePath("docs", "b.txt");
    // Nothing from the second op may run until the first completes.
    await new Promise((r) => setTimeout(r, 10));
    expect(ops).not.toContain("rm:/econome/docs/b.txt");
    release();
    await Promise.all([first, second]);
    expect(ops.indexOf("rm:/econome/docs/b.txt")).toBeGreaterThan(
      ops.indexOf("cp:/ipfs/bafyfile->/econome/docs/a.txt"),
    );
  });
});
