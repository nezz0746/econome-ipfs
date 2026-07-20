/**
 * Thin typed wrapper over the Kubo RPC API (default port 5001).
 * Responsibility: request shaping + response parsing only. No business logic.
 * Every endpoint is POST; repeated `arg` params carry positional arguments.
 * See https://docs.ipfs.tech/reference/kubo/rpc/
 */

export interface MfsEntry {
  name: string;
  type: "file" | "dir";
  size: number;
  cid: string;
}

export interface MfsStat {
  cid: string;
  size: number;
  cumulativeSize: number;
  type: "file" | "dir";
  blocks: number;
}

export interface KuboKey {
  name: string;
  id: string;
}

export class KuboClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async rpc(
    path: string,
    args: string[],
    params: Record<string, string> = {},
    body?: BodyInit,
  ): Promise<Response> {
    const search = new URLSearchParams(params);
    for (const arg of args) search.append("arg", arg);
    const res = await this.fetchImpl(
      `${this.baseUrl}/api/v0/${path}?${search}`,
      { method: "POST", body },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `kubo ${path} failed: ${res.status} ${detail.slice(0, 200)}`,
      );
    }
    return res;
  }

  async filesMkdir(path: string): Promise<void> {
    await this.rpc("files/mkdir", [path], { parents: "true" });
  }

  async filesLs(path: string): Promise<MfsEntry[]> {
    const res = await this.rpc("files/ls", [path], { long: "true" });
    const raw = (await res.json()) as {
      Entries?:
        | { Name?: string; Type?: number; Size?: number; Hash?: string }[]
        | null;
    };
    return (raw.Entries ?? []).map((e) => ({
      name: String(e.Name ?? ""),
      type: e.Type === 1 ? "dir" : "file",
      size: Number(e.Size ?? 0),
      cid: String(e.Hash ?? ""),
    }));
  }

  async filesStat(path: string): Promise<MfsStat> {
    const res = await this.rpc("files/stat", [path]);
    const raw = (await res.json()) as Record<string, unknown>;
    return {
      cid: String(raw.Hash ?? ""),
      size: Number(raw.Size ?? 0),
      cumulativeSize: Number(raw.CumulativeSize ?? 0),
      type: raw.Type === "directory" ? "dir" : "file",
      blocks: Number(raw.Blocks ?? 0),
    };
  }

  async filesCp(from: string, to: string): Promise<void> {
    await this.rpc("files/cp", [from, to], { parents: "true" });
  }

  async filesMv(from: string, to: string): Promise<void> {
    await this.rpc("files/mv", [from, to]);
  }

  async filesRm(path: string): Promise<void> {
    await this.rpc("files/rm", [path], { recursive: "true", force: "true" });
  }

  /** Flush a path to disk; returns the flushed (root) CID. */
  async filesFlush(path: string): Promise<string> {
    const res = await this.rpc("files/flush", [path]);
    const raw = (await res.json()) as { Cid?: string };
    const cid = String(raw.Cid ?? "");
    if (!cid) throw new Error(`kubo files/flush returned no CID for ${path}`);
    return cid;
  }

  /**
   * Add content to the blockstore WITHOUT pinning: folder contents are
   * protected by the folder root's recursive cluster pin, not per-file pins.
   */
  async addFile(content: Blob, name: string): Promise<string> {
    const form = new FormData();
    form.append("file", content, name);
    const res = await this.rpc(
      "add",
      [],
      { pin: "false", "cid-version": "1", "raw-leaves": "true" },
      form,
    );
    const raw = (await res.json()) as { Hash?: string };
    const cid = String(raw.Hash ?? "");
    if (!cid) throw new Error("kubo add returned no CID");
    return cid;
  }

  async keyGen(name: string): Promise<KuboKey> {
    const res = await this.rpc("key/gen", [name], {
      type: "ed25519",
      "ipns-base": "base36",
    });
    const raw = (await res.json()) as { Name?: string; Id?: string };
    return { name: String(raw.Name ?? name), id: String(raw.Id ?? "") };
  }

  async keyList(): Promise<KuboKey[]> {
    const res = await this.rpc("key/list", [], { "ipns-base": "base36" });
    const raw = (await res.json()) as {
      Keys?: { Name?: string; Id?: string }[];
    };
    return (raw.Keys ?? []).map((k) => ({
      name: String(k.Name ?? ""),
      id: String(k.Id ?? ""),
    }));
  }

  async keyRm(name: string): Promise<void> {
    await this.rpc("key/rm", [name]);
  }

  /**
   * Publish an IPNS record for the key. `allow-offline` keeps publishes
   * working in a small private swarm; Kubo's built-in republisher refreshes
   * the record while the node runs (no custom republish job needed).
   */
  async namePublish(keyName: string, ipfsPath: string): Promise<void> {
    await this.rpc("name/publish", [ipfsPath], {
      key: keyName,
      lifetime: "168h",
      "allow-offline": "true",
    });
  }
}
