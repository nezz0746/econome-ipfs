# MFS Folders + IPNS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mutable folders as Kubo MFS directories (folder root = the single cluster pin unit, tags in pin metadata) with one permanent IPNS name per folder, a Folders dashboard, and a multi-file/folder-mode upload form.

**Architecture:** A new `KuboClient` wraps the Kubo RPC API (`files/*`, `key/*`, `name/publish`, `add?pin=false`). A `FolderService` owns the commit primitive (flush → pin new root → publish IPNS → unpin old roots), per-folder mutation serialization, and a reconcile sweep (MFS wins). Routes mount twice: `/folders` (API-key, machines) and `/cluster/folders` (internal token, web BFF). Postgres is convenience-only — existing `uploads` rows keep being recorded; no new tables.

**Tech Stack:** Hono, Kubo RPC API, IPFS Cluster REST API, Next.js App Router (server components + server actions), vitest, Drizzle (untouched).

**Spec:** `docs/superpowers/specs/2026-07-20-mfs-folders-ipns-design.md`

## Global Constraints

- Branch: `feat/mfs-folders-ipns` (already created; work on it).
- Node ≥ 22 required for tests (`File` global) — `nvm use 22` if the default shell resolves Node 18.
- TypeScript strict + `noUncheckedIndexedAccess`: never index arrays/records without handling `undefined`.
- Lint/format: `pnpm exec biome check --write <paths>` before each commit (gates are NOT in CI — run them yourself).
- Type gate: `pnpm --filter api check-types` / `pnpm --filter web check-types`.
- Tests: `pnpm --filter api test` (vitest; api tests live in `apps/api/test/*.test.ts`).
- MFS layout: folders live at `/econome/<name>`. Folder names match `/^[a-z0-9][a-z0-9-]{0,63}$/`.
- IPNS key per folder named `econome-folder-<name>`, ed25519, ids in base36 (`k51…`). Publish with `lifetime=168h&allow-offline=true`. No custom republish job.
- Cluster pin per folder: name `folder:<name>`, metadata `folder=<name>` plus existing `tags` key. Pin new root BEFORE unpinning old roots, always.
- Every commit message ends with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.

---

### Task 1: KuboClient + dev-compose wiring

**Files:**
- Create: `apps/api/src/kubo-client.ts`
- Test: `apps/api/test/kubo-client.test.ts`
- Modify: `docker-compose.yml` (kubo ports, api env)

**Interfaces:**
- Consumes: nothing (leaf module; mirrors `cluster-client.ts` style — request shaping + parsing only, no business logic).
- Produces (used by Tasks 3–5):
  ```ts
  export interface MfsEntry { name: string; type: "file" | "dir"; size: number; cid: string }
  export interface MfsStat { cid: string; size: number; cumulativeSize: number; type: "file" | "dir"; blocks: number }
  export interface KuboKey { name: string; id: string }
  export class KuboClient {
    constructor(baseUrl: string, fetchImpl?: typeof fetch)
    filesMkdir(path: string): Promise<void>
    filesLs(path: string): Promise<MfsEntry[]>
    filesStat(path: string): Promise<MfsStat>
    filesCp(from: string, to: string): Promise<void>
    filesMv(from: string, to: string): Promise<void>
    filesRm(path: string): Promise<void>
    filesFlush(path: string): Promise<string> // returns the flushed root CID
    addFile(content: Blob, name: string): Promise<string> // add?pin=false, returns CID
    keyGen(name: string): Promise<KuboKey>
    keyList(): Promise<KuboKey[]>
    keyRm(name: string): Promise<void>
    namePublish(keyName: string, ipfsPath: string): Promise<void>
  }
  ```

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/kubo-client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { KuboClient } from "../src/kubo-client";

/** fetch stub that records calls and replies with the given JSON per call. */
function fakeFetch(...replies: unknown[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let i = 0;
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const body = replies[Math.min(i++, replies.length - 1)];
    return new Response(JSON.stringify(body ?? {}), { status: 200 });
  });
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
    const { impl, calls } = fakeFetch({ Name: "a.txt", Hash: "bafyfile", Size: "11" });
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
    expect(await new KuboClient("http://kubo:5001", list.impl).keyList()).toEqual([
      { name: "self", id: "k51self" },
      { name: "econome-folder-docs", id: "k51abc" },
    ]);
  });

  it("namePublish targets the key with lifetime + allow-offline", async () => {
    const { impl, calls } = fakeFetch({ Name: "k51abc", Value: "/ipfs/bafyroot" });
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api test -- kubo-client`
Expected: FAIL — `Cannot find module '../src/kubo-client'`

- [ ] **Step 3: Implement `apps/api/src/kubo-client.ts`**

```ts
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
      Entries?: { Name?: string; Type?: number; Size?: number; Hash?: string }[] | null;
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter api test -- kubo-client`
Expected: PASS (10 tests)

- [ ] **Step 5: Wire dev compose**

In `docker-compose.yml`, change the `kubo` service `ports` block from:

```yaml
    ports:
      - "4001:4001" # swarm
      - "8081:8080" # gateway (host 8081 to avoid clashing with the API)
```

to:

```yaml
    ports:
      - "4001:4001" # swarm
      - "8081:8080" # gateway (host 8081 to avoid clashing with the API)
      - "127.0.0.1:5001:5001" # RPC API — loopback only, for the host-run dev API (MFS/IPNS)
```

and in the `api` service `environment` block, after the `CLUSTER_API_URL` line, add:

```yaml
      IPFS_API_URL: ${IPFS_API_URL:-http://kubo:5001}
```

(`docker-compose.prod.yml` already sets `IPFS_API_URL: http://kubo:5001` — no prod change.)

Run: `docker compose config >/dev/null && echo ok`
Expected: `ok`

- [ ] **Step 6: Gates + commit**

```bash
pnpm exec biome check --write apps/api docker-compose.yml
pnpm --filter api check-types
git add apps/api/src/kubo-client.ts apps/api/test/kubo-client.test.ts docker-compose.yml
git commit -m "feat(api): KuboClient for MFS/IPNS RPC + dev compose kubo API wiring"
```

---

### Task 2: Extract `tagPinOptions` + make reallocation preserve pin metadata

**Files:**
- Modify: `apps/api/src/tags.ts`
- Modify: `apps/api/src/app.ts:97-111` (the `pinOptionsForTags` closure)
- Modify: `apps/api/src/reallocation.ts`
- Test: `apps/api/test/tags.test.ts` (append), `apps/api/test/reallocation.test.ts` (adjust)

**Interfaces:**
- Consumes: `desiredAllocations`, `TAGS_META_KEY` (already in tags.ts); `PinOptions` from `cluster-client.ts`.
- Produces (used by Task 3 and app.ts):
  ```ts
  export function tagPinOptions(
    tags: string[],
    mainPeerId: string,
    subscriptions: TagSubscription[],
  ): PinOptions
  export interface RepinAction {
    cid: string; name: string; tags: string[]; allocations: string[];
    metadata: Record<string, string>;   // NEW: the pin's full existing metadata
  }
  ```
  `tagPinOptions` behavior is identical to today's closure: untagged → `{replicationMin: 1, replicationMax: 1, userAllocations: [main]}`; tagged → allocations = main + subscribers, plus `metadata: { tags: "a,b" }`.
- WHY the reallocation change: today the job re-pins with ONLY the `tags` metadata key. Folder pins (Task 3) carry an additional `folder=<name>` key — a re-pin that drops it would orphan the folder pin from commit/reconcile. The job must re-pin with the pin's full existing metadata, preserved verbatim.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/tags.test.ts`:

```ts
import { tagPinOptions } from "../src/tags";

describe("tagPinOptions", () => {
  const subs = [
    { peerId: "peer-b", subscribedTags: ["photos"] },
    { peerId: "peer-c", subscribedTags: ["videos"] },
  ];

  it("pins untagged content to the main peer only, no metadata", () => {
    expect(tagPinOptions([], "peer-a", subs)).toEqual({
      replicationMin: 1,
      replicationMax: 1,
      userAllocations: ["peer-a"],
    });
  });

  it("allocates tagged content to main + subscribers with tags metadata", () => {
    expect(tagPinOptions(["photos"], "peer-a", subs)).toEqual({
      replicationMin: 1,
      replicationMax: 2,
      userAllocations: ["peer-a", "peer-b"],
      metadata: { tags: "photos" },
    });
  });
});

describe("planReallocations metadata carry-over", () => {
  it("returns the pin's full metadata so re-pins preserve extra keys", () => {
    const pins = [
      {
        cid: "bafyfolder",
        name: "folder:docs",
        allocations: ["peer-a"],
        replicationFactorMin: 1,
        replicationFactorMax: 1,
        metadata: { tags: "photos", folder: "docs" },
      },
    ];
    const actions = planReallocations(
      pins,
      [{ peerId: "peer-b", subscribedTags: ["photos"] }],
      "peer-a",
      new Set(["peer-a", "peer-b"]),
    );
    expect(actions[0]?.metadata).toEqual({ tags: "photos", folder: "docs" });
  });
});
```

(If the file lacks a `describe` import from vitest it already imports it — this test file exists; match its existing import line.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api test -- tags`
Expected: FAIL — `tagPinOptions` is not exported

- [ ] **Step 3: Implement**

In `apps/api/src/tags.ts`, add at the top: `import type { PinInfo, PinOptions } from "./cluster-client";` (extending the existing `PinInfo` import), and after `desiredAllocations` add:

```ts
/**
 * Pin options for content with the given tags. Replication is opt-in:
 * untagged content pins to the main peer only; tagged content is allocated
 * to the main peer + subscribers and carries its tags in pin metadata.
 */
export function tagPinOptions(
  tags: string[],
  mainPeerId: string,
  subscriptions: TagSubscription[],
): PinOptions {
  const allocations =
    tags.length === 0
      ? [mainPeerId]
      : desiredAllocations(tags, mainPeerId, subscriptions);
  return {
    replicationMin: 1,
    replicationMax: allocations.length,
    userAllocations: allocations,
    ...(tags.length > 0 && {
      metadata: { [TAGS_META_KEY]: tags.join(",") },
    }),
  };
}
```

In `apps/api/src/app.ts`, replace the body of the `pinOptionsForTags` closure (lines 97–111) with:

```ts
  async function pinOptionsForTags(tags: string[]): Promise<PinOptions> {
    return tagPinOptions(
      tags,
      await getMainPeerId(),
      await deps.listTagSubscriptions(),
    );
  }
```

and add `tagPinOptions` to the existing `./tags` import. Keep the doc comment above the closure.

Then make reallocation metadata-preserving:

1. In `apps/api/src/tags.ts`, extend `RepinAction` with `metadata: Record<string, string>;` and in `planReallocations`, build actions as:

```ts
      actions.push({
        cid: pin.cid,
        name: pin.name,
        tags,
        allocations: desired,
        metadata: pin.metadata,
      });
```

2. In `apps/api/src/reallocation.ts`, replace the `pinByCid` options (lines 31–39) with:

```ts
      await deps.cluster.pinByCid(action.cid, {
        replicationMin: 1,
        replicationMax: action.allocations.length,
        userAllocations: action.allocations,
        name: action.name || undefined,
        // Preserve the pin's metadata verbatim: besides `tags`, folder pins
        // carry a `folder` key that commit/reconcile use to find them.
        ...(Object.keys(action.metadata).length > 0 && {
          metadata: action.metadata,
        }),
      });
```

3. If any existing test in `apps/api/test/reallocation.test.ts` or `apps/api/test/tags.test.ts` asserts the exact re-pin options or `RepinAction` shape, update it to include the carried `metadata` — the tags key inside `metadata` is now sourced from the pin's stored metadata rather than re-joined from `action.tags` (same value for all existing pins).

- [ ] **Step 4: Run the full api suite (behavior must be unchanged for non-folder pins)**

Run: `pnpm --filter api test`
Expected: PASS — including all pre-existing `app.test.ts` ingest allocation assertions

- [ ] **Step 5: Gates + commit**

```bash
pnpm exec biome check --write apps/api
pnpm --filter api check-types
git add apps/api/src/tags.ts apps/api/src/app.ts apps/api/src/reallocation.ts apps/api/test/tags.test.ts apps/api/test/reallocation.test.ts
git commit -m "refactor(api): extract tagPinOptions + preserve pin metadata on reallocation"
```

---

### Task 3: FolderService — create, commit, list, get

**Files:**
- Create: `apps/api/src/folder-service.ts`
- Test: `apps/api/test/folder-service.test.ts`

**Interfaces:**
- Consumes: `KuboClient`, `MfsEntry` (Task 1); `tagPinOptions`, `parseTags`, `TAGS_META_KEY`, `TagSubscription` (Task 2 / tags.ts); `PinInfo`, `PinOptions`, `ClusterClient` types.
- Produces (used by Tasks 4–6):
  ```ts
  export const FOLDER_META_KEY = "folder";
  export const FOLDER_ROOT = "/econome";
  export const KEY_PREFIX = "econome-folder-";
  export function isValidFolderName(name: string): boolean
  export function isValidRelPath(path: string): boolean
  export interface FolderSummary { name: string; rootCid: string; ipnsName: string | null; size: number; tags: string[] }
  export interface FolderDetail extends FolderSummary { path: string; entries: MfsEntry[] }
  export interface FolderServiceDeps {
    kubo: KuboClient;
    cluster: Pick<ClusterClient, "pins" | "pinByCid" | "unpin">;
    getMainPeerId: () => Promise<string>;
    listTagSubscriptions: () => Promise<TagSubscription[]>;
    log?: (msg: string) => void;
  }
  export class FolderService {
    constructor(deps: FolderServiceDeps)
    create(name: string, tags: string[]): Promise<{ name: string; rootCid: string; ipnsName: string }>
    list(): Promise<FolderSummary[]>
    get(name: string, path?: string): Promise<FolderDetail | null>
  }
  ```
- IMPORTANT (for Task 5's wiring): the service must be constructed with the **uncached** ClusterClient — the 15s read cache in `cluster-cache.ts` would make commit read a stale pinset right after pinning.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/folder-service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    filesCp: vi.fn(async (f: string, t: string) => void ops.push(`cp:${f}->${t}`)),
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
    keyList: vi.fn(async () => [
      { name: "econome-folder-docs", id: "k51abc" },
    ]),
    keyRm: vi.fn(async (name: string) => void ops.push(`keyrm:${name}`)),
    namePublish: vi.fn(async (key: string, path: string) =>
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
    expect(res).toEqual({ name: "docs", rootCid: "bafyroot", ipnsName: "k51abc" });
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
      new Error("kubo key/gen failed: 500 key with name 'econome-folder-docs' already exists"),
    );
    const res = await service.create("docs", []);
    expect(res.ipnsName).toBe("k51abc"); // recovered via keyList
  });

  it("rejects invalid names", async () => {
    const { service } = makeFakes();
    await expect(service.create("../x", [])).rejects.toThrow(/invalid folder name/);
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
    const { service, kubo } = makeFakes({ pins: [folderPin({ cid: "bafyroot" })] });
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api test -- folder-service`
Expected: FAIL — `Cannot find module '../src/folder-service'`

- [ ] **Step 3: Implement `apps/api/src/folder-service.ts`**

```ts
/**
 * Mutable folders backed by Kubo MFS + cluster pins + IPNS.
 *
 * Sources of truth (no DB): the MFS tree under /econome/<name> IS the folder;
 * the folder's cluster pin carries its tags (`tags`) and identity (`folder`)
 * in pin metadata; the IPNS key `econome-folder-<name>` in Kubo's keystore is
 * its permanent name. Every mutation ends in commit(): flush -> pin the new
 * root -> publish IPNS -> unpin stale roots. The new root is pinned before
 * old roots are released, so content is never unprotected. Mutations are
 * serialized per folder to prevent root races.
 */

import type { ClusterClient, PinInfo, PinOptions } from "./cluster-client";
import type { KuboClient, MfsEntry } from "./kubo-client";
import {
  parseTags,
  TAGS_META_KEY,
  type TagSubscription,
  tagPinOptions,
} from "./tags";

export const FOLDER_META_KEY = "folder";
export const FOLDER_ROOT = "/econome";
export const KEY_PREFIX = "econome-folder-";

const FOLDER_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isValidFolderName(name: string): boolean {
  return FOLDER_NAME_RE.test(name);
}

/** Relative path inside a folder: non-empty slash-separated segments, no traversal. */
export function isValidRelPath(path: string): boolean {
  if (path.length === 0 || path.length > 1024) return false;
  if (path.includes("\\")) return false;
  const segments = path.split("/");
  return segments.every(
    (s) => s.length > 0 && s !== "." && s !== "..",
  );
}

export interface FolderSummary {
  name: string;
  rootCid: string;
  ipnsName: string | null;
  size: number;
  tags: string[];
}

export interface FolderDetail extends FolderSummary {
  path: string;
  entries: MfsEntry[];
}

export interface FolderServiceDeps {
  kubo: KuboClient;
  /**
   * MUST be the uncached ClusterClient: commit re-reads the pinset right
   * after pinning, which the 15s dashboard read-cache would serve stale.
   */
  cluster: Pick<ClusterClient, "pins" | "pinByCid" | "unpin">;
  getMainPeerId: () => Promise<string>;
  listTagSubscriptions: () => Promise<TagSubscription[]>;
  log?: (msg: string) => void;
}

const notFound = (err: unknown) =>
  err instanceof Error && /does not exist|not found/i.test(err.message);

export class FolderService {
  private queues = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: FolderServiceDeps) {}

  private log(msg: string) {
    (this.deps.log ?? console.log)(`[folders] ${msg}`);
  }

  /** Serialize mutations per folder; a failed op never blocks the next one. */
  protected enqueue<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(name) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.queues.set(
      name,
      next.catch(() => {}),
    );
    return next;
  }

  private mfsPath(name: string, relPath = ""): string {
    return relPath ? `${FOLDER_ROOT}/${name}/${relPath}` : `${FOLDER_ROOT}/${name}`;
  }

  private folderPins(pins: PinInfo[], name: string): PinInfo[] {
    return pins.filter((p) => p.metadata[FOLDER_META_KEY] === name);
  }

  private async pinOptions(name: string, tags: string[]): Promise<PinOptions> {
    const base = tagPinOptions(
      tags,
      await this.deps.getMainPeerId(),
      await this.deps.listTagSubscriptions(),
    );
    return {
      ...base,
      name: `folder:${name}`,
      metadata: { ...base.metadata, [FOLDER_META_KEY]: name },
    };
  }

  /**
   * The commit primitive: flush the MFS dir, pin the new root (before
   * releasing anything), publish IPNS, then unpin stale roots best-effort
   * (the reconcile sweep catches missed ones). `tags` defaults to the tags
   * on the folder's existing pin.
   */
  protected async commit(name: string, tags?: string[]): Promise<string> {
    const rootCid = await this.deps.kubo.filesFlush(this.mfsPath(name));
    const mine = this.folderPins(await this.deps.cluster.pins(), name);
    const effectiveTags =
      tags ??
      (mine[0] ? (parseTags(mine[0].metadata[TAGS_META_KEY]) ?? []) : []);

    if (!mine.some((p) => p.cid === rootCid)) {
      await this.deps.cluster.pinByCid(
        rootCid,
        await this.pinOptions(name, effectiveTags),
      );
    }
    await this.deps.kubo.namePublish(`${KEY_PREFIX}${name}`, `/ipfs/${rootCid}`);
    for (const stale of mine.filter((p) => p.cid !== rootCid)) {
      await this.deps.cluster
        .unpin(stale.cid)
        .catch((err) =>
          this.log(`unpin of stale root ${stale.cid} failed: ${err}`),
        );
    }
    return rootCid;
  }

  /** Idempotent: re-creating an existing folder re-pins + republishes it. */
  async create(
    name: string,
    tags: string[],
  ): Promise<{ name: string; rootCid: string; ipnsName: string }> {
    if (!isValidFolderName(name)) {
      throw new Error(`invalid folder name: ${name}`);
    }
    return this.enqueue(name, async () => {
      await this.deps.kubo.filesMkdir(this.mfsPath(name));
      let ipnsName: string;
      try {
        ipnsName = (await this.deps.kubo.keyGen(`${KEY_PREFIX}${name}`)).id;
      } catch (err) {
        if (!(err instanceof Error && /already exists/i.test(err.message))) {
          throw err;
        }
        const existing = (await this.deps.kubo.keyList()).find(
          (k) => k.name === `${KEY_PREFIX}${name}`,
        );
        if (!existing) throw err;
        ipnsName = existing.id;
      }
      const rootCid = await this.commit(name, tags);
      return { name, rootCid, ipnsName };
    });
  }

  async list(): Promise<FolderSummary[]> {
    let dirs: MfsEntry[];
    try {
      dirs = (await this.deps.kubo.filesLs(FOLDER_ROOT)).filter(
        (e) => e.type === "dir",
      );
    } catch (err) {
      if (notFound(err)) return []; // /econome not created yet
      throw err;
    }
    if (dirs.length === 0) return [];
    const [keys, pins] = await Promise.all([
      this.deps.kubo.keyList(),
      this.deps.cluster.pins(),
    ]);
    const summaries: FolderSummary[] = [];
    for (const dir of dirs) {
      const stat = await this.deps.kubo.filesStat(this.mfsPath(dir.name));
      const pin = this.folderPins(pins, dir.name)[0];
      summaries.push({
        name: dir.name,
        rootCid: stat.cid,
        ipnsName:
          keys.find((k) => k.name === `${KEY_PREFIX}${dir.name}`)?.id ?? null,
        size: stat.cumulativeSize,
        tags: pin ? (parseTags(pin.metadata[TAGS_META_KEY]) ?? []) : [],
      });
    }
    return summaries;
  }

  async get(name: string, path = ""): Promise<FolderDetail | null> {
    if (!isValidFolderName(name)) return null;
    if (path !== "" && !isValidRelPath(path)) return null;
    try {
      const stat = await this.deps.kubo.filesStat(this.mfsPath(name));
      const [entries, keys, pins] = await Promise.all([
        this.deps.kubo.filesLs(this.mfsPath(name, path)),
        this.deps.kubo.keyList(),
        this.deps.cluster.pins(),
      ]);
      const pin = this.folderPins(pins, name)[0];
      return {
        name,
        rootCid: stat.cid,
        ipnsName: keys.find((k) => k.name === `${KEY_PREFIX}${name}`)?.id ?? null,
        size: stat.cumulativeSize,
        tags: pin ? (parseTags(pin.metadata[TAGS_META_KEY]) ?? []) : [],
        path,
        entries,
      };
    } catch (err) {
      if (notFound(err)) return null;
      throw err;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter api test -- folder-service`
Expected: PASS

- [ ] **Step 5: Gates + commit**

```bash
pnpm exec biome check --write apps/api
pnpm --filter api check-types
git add apps/api/src/folder-service.ts apps/api/test/folder-service.test.ts
git commit -m "feat(api): FolderService core — create/commit/list/get over MFS + cluster + IPNS"
```

---

### Task 4: FolderService — mutations (addFiles, addCids, move, remove, setTags, delete)

**Files:**
- Modify: `apps/api/src/folder-service.ts`
- Test: `apps/api/test/folder-service.test.ts` (append)

**Interfaces:**
- Consumes: Task 3's class internals (`enqueue`, `commit`, `mfsPath`, `pinOptions`, validators).
- Produces (used by Task 6's routes):
  ```ts
  addFiles(name: string, files: { content: Blob; path: string }[], opts?: { commit?: boolean }):
    Promise<{ added: { path: string; cid: string }[]; rootCid: string | null }>
  addCids(name: string, entries: { cid: string; path: string }[]):
    Promise<{ rootCid: string }>
  movePath(name: string, from: string, to: string): Promise<{ rootCid: string }>
  removePath(name: string, path: string): Promise<{ rootCid: string }>
  setTags(name: string, tags: string[]): Promise<void>   // re-pin current root, no publish
  remove(name: string): Promise<void>                    // unpin all roots, rm MFS dir, rm key
  ```
  All throw `Error("invalid folder name: …")` / `Error("invalid path: …")` on bad input and `Error("folder not found: …")` when the MFS dir is missing (route layer maps these to 400/404).

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/folder-service.test.ts`:

```ts
describe("mutations", () => {
  it("addFiles adds unpinned bytes, cps into place, commits once", async () => {
    const { service, kubo, ops } = makeFakes({ pins: [folderPin({ cid: "bafyroot" })] });
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api test -- folder-service`
Expected: FAIL — `addFiles is not a function` (and siblings)

- [ ] **Step 3: Implement — append these methods to `FolderService`**

```ts
  private assertFolderName(name: string) {
    if (!isValidFolderName(name)) throw new Error(`invalid folder name: ${name}`);
  }

  private assertRelPath(path: string) {
    if (!isValidRelPath(path)) throw new Error(`invalid path: ${path}`);
  }

  private async assertExists(name: string) {
    try {
      await this.deps.kubo.filesStat(this.mfsPath(name));
    } catch (err) {
      if (notFound(err)) throw new Error(`folder not found: ${name}`);
      throw err;
    }
  }

  /**
   * Upload file bytes into the folder. Bytes go to the blockstore unpinned
   * (`add?pin=false`) — the folder root's recursive cluster pin protects
   * them once cp'd in. `commit: false` stages without pinning/publishing;
   * callers doing chunked uploads commit on their last request (the
   * reconcile sweep heals an interrupted sequence).
   */
  async addFiles(
    name: string,
    files: { content: Blob; path: string }[],
    opts: { commit?: boolean } = {},
  ): Promise<{ added: { path: string; cid: string }[]; rootCid: string | null }> {
    this.assertFolderName(name);
    for (const f of files) this.assertRelPath(f.path);
    return this.enqueue(name, async () => {
      await this.assertExists(name);
      const added: { path: string; cid: string }[] = [];
      for (const f of files) {
        const base = f.path.split("/").pop() ?? f.path;
        const cid = await this.deps.kubo.addFile(f.content, base);
        await this.deps.kubo.filesCp(`/ipfs/${cid}`, this.mfsPath(name, f.path));
        added.push({ path: f.path, cid });
      }
      const rootCid = opts.commit === false ? null : await this.commit(name);
      return { added, rootCid };
    });
  }

  /** Mount already-stored CIDs into the folder tree. */
  async addCids(
    name: string,
    entries: { cid: string; path: string }[],
  ): Promise<{ rootCid: string }> {
    this.assertFolderName(name);
    for (const e of entries) this.assertRelPath(e.path);
    return this.enqueue(name, async () => {
      await this.assertExists(name);
      for (const e of entries) {
        await this.deps.kubo.filesCp(`/ipfs/${e.cid}`, this.mfsPath(name, e.path));
      }
      return { rootCid: await this.commit(name) };
    });
  }

  async movePath(
    name: string,
    from: string,
    to: string,
  ): Promise<{ rootCid: string }> {
    this.assertFolderName(name);
    this.assertRelPath(from);
    this.assertRelPath(to);
    return this.enqueue(name, async () => {
      await this.assertExists(name);
      await this.deps.kubo.filesMv(this.mfsPath(name, from), this.mfsPath(name, to));
      return { rootCid: await this.commit(name) };
    });
  }

  async removePath(name: string, path: string): Promise<{ rootCid: string }> {
    this.assertFolderName(name);
    this.assertRelPath(path);
    return this.enqueue(name, async () => {
      await this.assertExists(name);
      await this.deps.kubo.filesRm(this.mfsPath(name, path));
      return { rootCid: await this.commit(name) };
    });
  }

  /** Retarget replication: re-pin the current root with new tag metadata. */
  async setTags(name: string, tags: string[]): Promise<void> {
    this.assertFolderName(name);
    await this.enqueue(name, async () => {
      await this.assertExists(name);
      const rootCid = await this.deps.kubo.filesFlush(this.mfsPath(name));
      await this.deps.cluster.pinByCid(rootCid, await this.pinOptions(name, tags));
    });
  }

  /**
   * Delete the folder: release every cluster pin, remove the MFS dir, and
   * retire the IPNS key (the /ipns/ name stops resolving permanently).
   */
  async remove(name: string): Promise<void> {
    this.assertFolderName(name);
    await this.enqueue(name, async () => {
      const mine = this.folderPins(await this.deps.cluster.pins(), name);
      for (const pin of mine) {
        await this.deps.cluster
          .unpin(pin.cid)
          .catch((err) => this.log(`unpin ${pin.cid} failed: ${err}`));
      }
      await this.deps.kubo.filesRm(this.mfsPath(name));
      await this.deps.kubo
        .keyRm(`${KEY_PREFIX}${name}`)
        .catch((err) => this.log(`key rm for ${name} failed: ${err}`));
    });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter api test -- folder-service`
Expected: PASS (all Task 3 + Task 4 tests)

- [ ] **Step 5: Gates + commit**

```bash
pnpm exec biome check --write apps/api
pnpm --filter api check-types
git add apps/api/src/folder-service.ts apps/api/test/folder-service.test.ts
git commit -m "feat(api): folder mutations — addFiles/addCids/move/remove/setTags/delete"
```

---

### Task 5: Reconcile sweep + index.ts wiring

**Files:**
- Modify: `apps/api/src/folder-service.ts` (add `reconcile`)
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/test/folder-service.test.ts` (append)

**Interfaces:**
- Consumes: everything from Tasks 3–4; `index.ts` structures around `apps/api/src/index.ts:24-33` (client construction) and `:245-276` (job scheduling).
- Produces: `reconcile(): Promise<{ repinned: number; cleaned: number }>` — used by boot + the accounting tick. `index.ts` exposes nothing new; it constructs `KuboClient` + `FolderService` and passes the service into `createApp` via the new `AppDeps.folders` (Task 6 adds the field — in THIS task, construct the service and schedule reconcile only; the `createApp` hookup lands in Task 6).

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/folder-service.test.ts`:

```ts
describe("reconcile", () => {
  it("re-pins + republishes a drifted folder and unpins stale roots", async () => {
    const { service, ops, kubo } = makeFakes({
      pins: [folderPin({ cid: "bafyold" })],
      root: "bafynew",
    });
    (kubo.filesLs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { name: "docs", type: "dir", size: 0, cid: "bafynew" },
    ]);
    const res = await service.reconcile();
    expect(res).toEqual({ repinned: 1, cleaned: 1 });
    expect(ops.indexOf("pin:bafynew")).toBeGreaterThan(-1);
    expect(ops.indexOf("unpin:bafyold")).toBeGreaterThan(ops.indexOf("pin:bafynew"));
    expect(ops).toContain("publish:econome-folder-docs:/ipfs/bafynew");
  });

  it("does nothing when pins already match MFS", async () => {
    const { service, cluster, kubo } = makeFakes({
      pins: [folderPin({ cid: "bafyroot" })],
      root: "bafyroot",
    });
    (kubo.filesLs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { name: "docs", type: "dir", size: 0, cid: "bafyroot" },
    ]);
    const res = await service.reconcile();
    expect(res).toEqual({ repinned: 0, cleaned: 0 });
    expect(cluster.pinByCid).not.toHaveBeenCalled();
    expect(kubo.namePublish).not.toHaveBeenCalled();
  });

  it("unpins orphan folder pins whose MFS dir is gone (MFS wins)", async () => {
    const { service, ops, kubo } = makeFakes({
      pins: [folderPin({ cid: "bafyghost", metadata: { folder: "ghost" } })],
    });
    (kubo.filesLs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const res = await service.reconcile();
    expect(res).toEqual({ repinned: 0, cleaned: 1 });
    expect(ops).toContain("unpin:bafyghost");
  });

  it("survives an empty MFS (no /econome yet)", async () => {
    const { service, kubo } = makeFakes();
    (kubo.filesLs as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("kubo files/ls failed: 500 file does not exist"),
    );
    expect(await service.reconcile()).toEqual({ repinned: 0, cleaned: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api test -- folder-service`
Expected: FAIL — `reconcile is not a function`

- [ ] **Step 3: Implement — append to `FolderService`**

```ts
  /**
   * Drift healing: MFS always wins. For each MFS folder, ensure the flushed
   * root is the pinned+published one and stale roots are released; unpin
   * folder pins whose MFS dir no longer exists (interrupted deletes). Covers
   * every crash-mid-commit case; runs at boot and on the accounting tick.
   */
  async reconcile(): Promise<{ repinned: number; cleaned: number }> {
    let dirs: MfsEntry[];
    try {
      dirs = (await this.deps.kubo.filesLs(FOLDER_ROOT)).filter(
        (e) => e.type === "dir",
      );
    } catch (err) {
      if (notFound(err)) dirs = [];
      else throw err;
    }
    const pins = await this.deps.cluster.pins();
    let repinned = 0;
    let cleaned = 0;

    for (const dir of dirs) {
      await this.enqueue(dir.name, async () => {
        const rootCid = await this.deps.kubo.filesFlush(this.mfsPath(dir.name));
        const mine = this.folderPins(pins, dir.name);
        if (!mine.some((p) => p.cid === rootCid)) {
          const tags = mine[0]
            ? (parseTags(mine[0].metadata[TAGS_META_KEY]) ?? [])
            : [];
          await this.deps.cluster.pinByCid(
            rootCid,
            await this.pinOptions(dir.name, tags),
          );
          await this.deps.kubo.namePublish(
            `${KEY_PREFIX}${dir.name}`,
            `/ipfs/${rootCid}`,
          );
          repinned += 1;
        }
        for (const stale of mine.filter((p) => p.cid !== rootCid)) {
          await this.deps.cluster
            .unpin(stale.cid)
            .catch((err) => this.log(`reconcile unpin ${stale.cid}: ${err}`));
          cleaned += 1;
        }
      });
    }

    const names = new Set(dirs.map((d) => d.name));
    for (const pin of pins) {
      const folder = pin.metadata[FOLDER_META_KEY];
      if (folder && !names.has(folder)) {
        await this.deps.cluster
          .unpin(pin.cid)
          .catch((err) => this.log(`reconcile orphan unpin ${pin.cid}: ${err}`));
        cleaned += 1;
      }
    }
    return { repinned, cleaned };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter api test -- folder-service`
Expected: PASS

- [ ] **Step 5: Wire `index.ts`**

In `apps/api/src/index.ts`:

1. Add imports:

```ts
import { FolderService } from "./folder-service";
import { KuboClient } from "./kubo-client";
```

2. Replace the cluster construction (currently `const cluster = cacheClusterReads(new ClusterClient(config.clusterApiUrl), CLUSTER_READ_TTL_MS);` around lines 30–33) with:

```ts
const clusterBase = new ClusterClient(config.clusterApiUrl);
const cluster = cacheClusterReads(clusterBase, CLUSTER_READ_TTL_MS);
```

3. After the `listTagSubscriptions` function definition, add:

```ts
const kubo = new KuboClient(config.ipfsApiUrl);

// Folder commits re-read the pinset immediately after pinning, so the
// service gets the raw client, not the 15s dashboard read-cache.
let cachedMainPeerId: Promise<string> | null = null;
const getMainPeerId = () => {
  cachedMainPeerId ??= clusterBase.id().catch((err) => {
    cachedMainPeerId = null;
    throw err;
  });
  return cachedMainPeerId;
};

const folderService = new FolderService({
  kubo,
  cluster: clusterBase,
  getMainPeerId,
  listTagSubscriptions,
});
```

4. In `main()`, after migrations succeed, add a boot reconcile:

```ts
  folderService
    .reconcile()
    .then((r) => {
      if (r.repinned || r.cleaned)
        console.log(
          `[folders] boot reconcile: repinned ${r.repinned}, cleaned ${r.cleaned}`,
        );
    })
    .catch((err) => console.error("[folders] boot reconcile failed:", err));
```

5. Inside the accounting `tick` (after the `runReallocationJob` call), add:

```ts
      folderService
        .reconcile()
        .then((r) => {
          if (r.repinned || r.cleaned)
            console.log(
              `[folders] reconciled: repinned ${r.repinned}, cleaned ${r.cleaned}`,
            );
        })
        .catch((err) => console.error("[folders] reconcile failed:", err));
```

- [ ] **Step 6: Verify boot compiles and gates pass**

```bash
pnpm --filter api check-types
pnpm --filter api test
pnpm exec biome check --write apps/api
git add apps/api/src/folder-service.ts apps/api/src/index.ts apps/api/test/folder-service.test.ts
git commit -m "feat(api): folder reconcile sweep + boot/interval wiring"
```

---

### Task 6: HTTP routes — `/folders` (API key) + `/cluster/folders` (internal)

**Files:**
- Create: `apps/api/src/folder-routes.ts`
- Modify: `apps/api/src/app.ts` (AppDeps + mounts)
- Modify: `apps/api/src/index.ts` (pass `folders: folderService` into `createApp`)
- Test: `apps/api/test/app.test.ts` (append)

**Interfaces:**
- Consumes: `FolderService` (Tasks 3–5), `parseTags` (tags.ts), `RecordedUpload`/`recordUpload` (app.ts deps), `apiKeyAuth` (auth.ts).
- Produces — HTTP contract (used by Task 7's web client). All routes exist under BOTH `/folders/*` (header `x-api-key`) and `/cluster/folders/*` (header `x-internal-token`):
  - `POST /` body `{name, tags?}` → 200 `{name, rootCid, ipnsName}` | 400
  - `GET /` → 200 `FolderSummary[]`
  - `GET /:name?path=sub/dir` → 200 `FolderDetail` | 404
  - `POST /:name/files?commit=false` multipart, repeated `file` + parallel repeated `path` fields → 200 `{added: [{path, cid}], rootCid: string | null}` | 400 | 404. Records an `uploads` row per file with `name = "<folder>/<path>"`.
  - `POST /:name/cids` body `{entries: [{cid, path}]}` → 200 `{rootCid}` | 400 | 404
  - `POST /:name/move` body `{from, to}` → 200 `{rootCid}` | 400 | 404
  - `DELETE /:name/files?path=a/b.txt` → 200 `{rootCid}` | 400 | 404
  - `PATCH /:name` body `{tags}` → 200 `{ok: true}` | 400 | 404
  - `DELETE /:name` → 200 `{deleted: true}` | 400
- New `AppDeps` field: `folders: FolderService`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/app.test.ts`. First extend `makeDeps` — add a `folders` fake to the returned object (inside the existing `makeDeps` before `...overrides`):

```ts
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
```

Then append the test suites:

```ts
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
    expect(deps.folders.movePath).toHaveBeenCalledWith("docs", "a.txt", "b/a.txt");

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api test -- app`
Expected: FAIL — type error on `AppDeps["folders"]` / 404s on `/folders`

- [ ] **Step 3: Implement `apps/api/src/folder-routes.ts`**

```ts
import { Hono } from "hono";

import type { RecordedUpload } from "./app";
import type { FolderService } from "./folder-service";
import { parseTags } from "./tags";

type Variables = { apiKeyId: string };

export interface FolderRouteDeps {
  folders: FolderService;
  recordUpload: (upload: RecordedUpload) => Promise<void>;
}

/** Map service validation errors to HTTP statuses. */
function errorStatus(err: unknown): 400 | 404 | 500 {
  if (!(err instanceof Error)) return 500;
  if (/^invalid /.test(err.message)) return 400;
  if (/^folder not found/.test(err.message)) return 404;
  return 500;
}

function handle(err: unknown) {
  const status = errorStatus(err);
  if (status === 500) throw err;
  return {
    status,
    body: { error: err instanceof Error ? err.message : "error" },
  } as const;
}

/**
 * Folder routes, auth-agnostic: mounted under /folders (API-key gated,
 * machine clients) AND /cluster/folders (internal token, web BFF).
 */
export function createFolderRoutes(
  deps: FolderRouteDeps,
): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>();

  app.post("/", async (c) => {
    let body: { name?: unknown; tags?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const name = typeof body.name === "string" ? body.name : "";
    const tags = parseTags(body.tags);
    if (tags === null) {
      return c.json({ error: "invalid 'tags': lowercase slugs expected" }, 400);
    }
    try {
      return c.json(await deps.folders.create(name, tags));
    } catch (err) {
      const e = handle(err);
      return c.json(e.body, e.status);
    }
  });

  app.get("/", async (c) => c.json(await deps.folders.list()));

  app.get("/:name", async (c) => {
    const detail = await deps.folders.get(
      c.req.param("name"),
      c.req.query("path") ?? "",
    );
    return detail ? c.json(detail) : c.json({ error: "folder not found" }, 404);
  });

  app.post("/:name/files", async (c) => {
    const name = c.req.param("name");
    const commit = c.req.query("commit") !== "false";
    const body = await c.req.parseBody({ all: true });
    const rawFiles = body.file;
    const rawPaths = body.path;
    const files = (Array.isArray(rawFiles) ? rawFiles : [rawFiles]).filter(
      (f): f is File => f instanceof File,
    );
    const paths = (Array.isArray(rawPaths) ? rawPaths : [rawPaths]).filter(
      (p): p is string => typeof p === "string" && p.length > 0,
    );
    if (files.length === 0) {
      return c.json({ error: "expected multipart field 'file'" }, 400);
    }
    if (paths.length > 0 && paths.length !== files.length) {
      return c.json({ error: "'path' fields must match 'file' fields 1:1" }, 400);
    }
    const entries = files.map((file, i) => ({
      content: file as Blob,
      path: paths[i] ?? file.name,
    }));
    try {
      const result = await deps.folders.addFiles(name, entries, { commit });
      const apiKeyId = c.get("apiKeyId") ?? null;
      for (const [i, added] of result.added.entries()) {
        const file = files[i];
        if (!file) continue;
        await deps
          .recordUpload({
            cid: added.cid,
            name: `${name}/${added.path}`,
            size: file.size,
            tags: [],
            apiKeyId,
          })
          .catch(() => {});
      }
      return c.json(result);
    } catch (err) {
      const e = handle(err);
      return c.json(e.body, e.status);
    }
  });

  app.post("/:name/cids", async (c) => {
    let body: { entries?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const entries = Array.isArray(body.entries) ? body.entries : [];
    if (
      entries.length === 0 ||
      !entries.every(
        (e): e is { cid: string; path: string } =>
          typeof (e as { cid?: unknown }).cid === "string" &&
          typeof (e as { path?: unknown }).path === "string",
      )
    ) {
      return c.json(
        { error: "expected 'entries' as a non-empty array of {cid, path}" },
        400,
      );
    }
    try {
      return c.json(await deps.folders.addCids(c.req.param("name"), entries));
    } catch (err) {
      const e = handle(err);
      return c.json(e.body, e.status);
    }
  });

  app.post("/:name/move", async (c) => {
    let body: { from?: unknown; to?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    if (typeof body.from !== "string" || typeof body.to !== "string") {
      return c.json({ error: "expected 'from' and 'to' paths" }, 400);
    }
    try {
      return c.json(
        await deps.folders.movePath(c.req.param("name"), body.from, body.to),
      );
    } catch (err) {
      const e = handle(err);
      return c.json(e.body, e.status);
    }
  });

  app.delete("/:name/files", async (c) => {
    const path = c.req.query("path") ?? "";
    try {
      return c.json(await deps.folders.removePath(c.req.param("name"), path));
    } catch (err) {
      const e = handle(err);
      return c.json(e.body, e.status);
    }
  });

  app.patch("/:name", async (c) => {
    let body: { tags?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const tags = parseTags(body.tags);
    if (tags === null) {
      return c.json({ error: "invalid 'tags': lowercase slugs expected" }, 400);
    }
    try {
      await deps.folders.setTags(c.req.param("name"), tags);
      return c.json({ ok: true });
    } catch (err) {
      const e = handle(err);
      return c.json(e.body, e.status);
    }
  });

  app.delete("/:name", async (c) => {
    try {
      await deps.folders.remove(c.req.param("name"));
      return c.json({ deleted: true });
    } catch (err) {
      const e = handle(err);
      return c.json(e.body, e.status);
    }
  });

  return app;
}
```

- [ ] **Step 4: Wire into `apps/api/src/app.ts` and `apps/api/src/index.ts`**

In `app.ts`:

1. Add imports: `import { createFolderRoutes } from "./folder-routes";` and `import type { FolderService } from "./folder-service";`
2. Add to `AppDeps`: `/** MFS-backed folders (create/mutate/list + reconcile). */ folders: FolderService;`
3. After the `/ingest/:cid` delete route (before the gateway section), add:

```ts
  // ----- Folders (MFS + IPNS) --------------------------------------------
  // Mounted twice: /folders for machine clients (API key), and under the
  // internal-token gateway below for the dashboard BFF.
  const folderRoutes = createFolderRoutes({
    folders: deps.folders,
    recordUpload: deps.recordUpload,
  });
  app.use("/folders", apiKeyAuth(deps.findApiKey));
  app.use("/folders/*", apiKeyAuth(deps.findApiKey));
  app.route("/folders", folderRoutes);
```

4. After the existing `gateway.get("/overview", …)` block (still before `app.route("/cluster", gateway)`), add:

```ts
  gateway.route("/folders", folderRoutes);
```

In `index.ts`, add `folders: folderService,` to the `createApp({ … })` deps object.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter api test`
Expected: PASS — new folder-route tests and every pre-existing test

- [ ] **Step 6: Gates + commit**

```bash
pnpm exec biome check --write apps/api
pnpm --filter api check-types
git add apps/api/src/folder-routes.ts apps/api/src/app.ts apps/api/src/index.ts apps/api/test/app.test.ts
git commit -m "feat(api): folder HTTP routes on /folders (api-key) + /cluster/folders (internal)"
```

---

### Task 7: Web BFF client + server actions

**Files:**
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/lib/actions.ts`

**Interfaces:**
- Consumes: the HTTP contract from Task 6; existing `gatewayFetch`, `HONO_URL`, `INTERNAL_TOKEN` in api.ts; `requireUserId`, `parseTags` in actions.ts.
- Produces (used by Tasks 8–9):
  ```ts
  // lib/api.ts
  export interface FolderSummary { name: string; rootCid: string; ipnsName: string | null; size: number; tags: string[] }
  export interface FolderEntry { name: string; type: "file" | "dir"; size: number; cid: string }
  export interface FolderDetail extends FolderSummary { path: string; entries: FolderEntry[] }
  export function getFolders(): Promise<FolderSummary[]>
  export function getFolder(name: string, path?: string): Promise<FolderDetail | null>
  export function createFolder(name: string, tags: string[]): Promise<FolderSummary>
  export function deleteFolder(name: string): Promise<void>
  export function deleteFolderPath(name: string, path: string): Promise<void>
  export function ingestCreateFolder(apiKey: string, name: string, tags: string[]): Promise<void>
  export function ingestFolderFile(apiKey: string, folder: string, file: File, path: string, commit: boolean): Promise<{ rootCid: string | null }>
  // lib/actions.ts
  export async function createFolderAction(formData: FormData): Promise<void>       // fields: name, tags
  export async function deleteFolderAction(formData: FormData): Promise<void>       // fields: name
  export async function deleteFolderEntryAction(formData: FormData): Promise<void>  // fields: name, path
  export interface FolderUploadResult { path: string; ok: boolean; error?: string; rootCid?: string | null }
  export async function ensureFolder(formData: FormData): Promise<{ ok: boolean; error?: string }>   // apiKey, folder, tags
  export async function uploadFolderFile(formData: FormData): Promise<FolderUploadResult>            // apiKey, folder, path, commit, file
  ```

- [ ] **Step 1: Add the API client functions**

Append to `apps/web/lib/api.ts`:

```ts
// ----- Folders (MFS + IPNS) ------------------------------------------------

export interface FolderSummary {
  name: string;
  rootCid: string;
  /** Permanent /ipns/ name (base36 key id), or null if the key is missing. */
  ipnsName: string | null;
  size: number;
  tags: string[];
}

export interface FolderEntry {
  name: string;
  type: "file" | "dir";
  size: number;
  cid: string;
}

export interface FolderDetail extends FolderSummary {
  path: string;
  entries: FolderEntry[];
}

async function gatewayMutate<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${HONO_URL}/cluster${path}`, {
    ...init,
    headers: {
      "x-internal-token": INTERNAL_TOKEN,
      "content-type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export function getFolders(): Promise<FolderSummary[]> {
  return gatewayFetch<FolderSummary[]>("/folders");
}

export async function getFolder(
  name: string,
  path = "",
): Promise<FolderDetail | null> {
  const qs = path ? `?path=${encodeURIComponent(path)}` : "";
  const res = await fetch(
    `${HONO_URL}/cluster/folders/${encodeURIComponent(name)}${qs}`,
    { headers: { "x-internal-token": INTERNAL_TOKEN }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API /folders/${name} failed: ${res.status}`);
  return res.json() as Promise<FolderDetail>;
}

export function createFolder(
  name: string,
  tags: string[],
): Promise<FolderSummary> {
  return gatewayMutate<FolderSummary>("/folders", {
    method: "POST",
    body: JSON.stringify({ name, tags }),
  });
}

export async function deleteFolder(name: string): Promise<void> {
  await gatewayMutate(`/folders/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

export async function deleteFolderPath(
  name: string,
  path: string,
): Promise<void> {
  await gatewayMutate(
    `/folders/${encodeURIComponent(name)}/files?path=${encodeURIComponent(path)}`,
    { method: "DELETE" },
  );
}

/** Create-or-reuse a folder through the machine (API-key) ingest path. */
export async function ingestCreateFolder(
  apiKey: string,
  name: string,
  tags: string[],
): Promise<void> {
  const res = await fetch(`${HONO_URL}/folders`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ name, tags }),
  });
  if (!res.ok) {
    throw new Error(`Folder create failed: ${res.status} ${await res.text()}`);
  }
}

/**
 * Upload one file into a folder through the API-key path. Chunked-batch
 * protocol: callers pass commit=false for all but the final file so the
 * whole batch lands as one folder version (one pin + one IPNS publish).
 */
export async function ingestFolderFile(
  apiKey: string,
  folder: string,
  file: File,
  path: string,
  commit: boolean,
): Promise<{ rootCid: string | null }> {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("path", path);
  const res = await fetch(
    `${HONO_URL}/folders/${encodeURIComponent(folder)}/files?commit=${commit}`,
    { method: "POST", headers: { "x-api-key": apiKey }, body: form },
  );
  if (!res.ok) {
    throw new Error(`Folder upload failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { rootCid: string | null };
  return { rootCid: body.rootCid };
}
```

- [ ] **Step 2: Add the server actions**

Append to `apps/web/lib/actions.ts` (extend the existing `@/lib/api` import with `createFolder, deleteFolder, deleteFolderPath, ingestCreateFolder, ingestFolderFile`):

```ts
// ----- Folders -------------------------------------------------------------

export async function createFolderAction(formData: FormData): Promise<void> {
  await requireUserId();
  const name = String(formData.get("name") ?? "").trim();
  const tags = parseTags(formData.get("tags"));
  if (tags === null) throw new Error("invalid tags");
  await createFolder(name, tags);
  revalidatePath("/dashboard/folders");
}

export async function deleteFolderAction(formData: FormData): Promise<void> {
  await requireUserId();
  await deleteFolder(String(formData.get("name") ?? ""));
  revalidatePath("/dashboard/folders");
}

export async function deleteFolderEntryAction(
  formData: FormData,
): Promise<void> {
  await requireUserId();
  const name = String(formData.get("name") ?? "");
  await deleteFolderPath(name, String(formData.get("path") ?? ""));
  revalidatePath(`/dashboard/folders/${encodeURIComponent(name)}`);
}

export interface FolderUploadResult {
  path: string;
  ok: boolean;
  error?: string;
  rootCid?: string | null;
}

/** Create-or-reuse the target folder before a folder-mode test upload. */
export async function ensureFolder(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await requireUserId();
  const apiKey = String(formData.get("apiKey") ?? "");
  const folder = String(formData.get("folder") ?? "").trim();
  const tags = parseTags(formData.get("tags"));
  if (!apiKey) return { ok: false, error: "API key required" };
  if (tags === null) return { ok: false, error: "Invalid tags" };
  try {
    await ingestCreateFolder(apiKey, folder, tags);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "failed" };
  }
}

/**
 * Upload one file of a folder-mode batch. The client sends one request per
 * file (each within the server-action body budget) with commit=false on all
 * but the last, so the batch commits as a single folder version.
 */
export async function uploadFolderFile(
  formData: FormData,
): Promise<FolderUploadResult> {
  await requireUserId();
  const apiKey = String(formData.get("apiKey") ?? "");
  const folder = String(formData.get("folder") ?? "").trim();
  const path = String(formData.get("path") ?? "");
  const commit = String(formData.get("commit") ?? "true") === "true";
  const file = formData.get("file");
  if (!apiKey) return { path, ok: false, error: "API key required" };
  if (!(file instanceof File) || file.size === 0) {
    return { path, ok: false, error: "Empty file" };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { path, ok: false, error: `Too large (max ${MAX_UPLOAD_MB} MB)` };
  }
  try {
    const res = await ingestFolderFile(apiKey, folder, file, path, commit);
    return { path, ok: true, rootCid: res.rootCid };
  } catch (err) {
    return {
      path,
      ok: false,
      error: err instanceof Error ? err.message : "upload failed",
    };
  }
}
```

- [ ] **Step 3: Gates + commit**

```bash
pnpm exec biome check --write apps/web
pnpm --filter web check-types
git add apps/web/lib/api.ts apps/web/lib/actions.ts
git commit -m "feat(web): folder BFF client + server actions"
```

---

### Task 8: Folders dashboard pages + sidebar link

**Files:**
- Create: `apps/web/app/dashboard/folders/page.tsx`
- Create: `apps/web/app/dashboard/folders/[name]/page.tsx`
- Create: `apps/web/components/create-folder-form.tsx`
- Modify: `apps/web/components/app-sidebar.tsx:32-37` (nav items)

**Interfaces:**
- Consumes: `getFolders`, `getFolder` (Task 7 api.ts); `createFolderAction`, `deleteFolderAction`, `deleteFolderEntryAction` (Task 7 actions.ts); existing UI kit (`Card`, `Table` etc. — mirror `apps/web/app/dashboard/files/page.tsx` for table markup and `formatBytes` from `@/lib/format` if present; check that file's imports and copy its table primitives exactly).
- Produces: routes `/dashboard/folders` and `/dashboard/folders/[name]?path=…`.
- Gateway links use `process.env.IPFS_GATEWAY_URL ?? "http://localhost:8081"` server-side (same pattern as the Files page — verify its exact env read and mirror it).

- [ ] **Step 1: Add the sidebar entry**

In `apps/web/components/app-sidebar.tsx`, add `FolderOpen` to the `lucide-react` import and insert after the Files item (line 33):

```ts
  { title: "Folders", url: "/dashboard/folders", icon: FolderOpen },
```

- [ ] **Step 2: Create `apps/web/components/create-folder-form.tsx`**

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createFolderAction } from "@/lib/actions";

export function CreateFolderForm() {
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setPending(true);
    try {
      await createFolderAction(new FormData(form));
      toast.success("Folder created");
      form.reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <div className="space-y-2">
        <Label htmlFor="folder-name">Name</Label>
        <Input
          id="folder-name"
          name="name"
          placeholder="e.g. photos-2026"
          pattern="[a-z0-9][a-z0-9-]{0,63}"
          title="lowercase letters, digits and dashes"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="folder-tags">Tags (optional)</Label>
        <Input id="folder-tags" name="tags" placeholder="photos,archive" />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create folder"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Create `apps/web/app/dashboard/folders/page.tsx`**

Before writing, open `apps/web/app/dashboard/files/page.tsx` and mirror its table imports (`Table`, `TableBody`, `TableCell`, `TableHead`, `TableHeader`, `TableRow` from `@/components/ui/table`), its byte formatter, its `TagBadges` usage, and its gateway-URL env read. Then:

```tsx
import Link from "next/link";

import { CreateFolderForm } from "@/components/create-folder-form";
import { PageHeader } from "@/components/page-header";
import { TagBadges } from "@/components/tag-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { deleteFolderAction } from "@/lib/actions";
import { getFolders } from "@/lib/api";
import { formatBytes } from "@/lib/format";

const GATEWAY = process.env.IPFS_GATEWAY_URL ?? "http://localhost:8081";

export const dynamic = "force-dynamic";

export default async function FoldersPage() {
  const folders = await getFolders();

  return (
    <>
      <PageHeader
        title="Folders"
        description="Mutable IPFS directories: each folder replicates as one unit (tags decide to which participants) and keeps a permanent /ipns/ URL pointing at its latest version."
      />

      <Card>
        <CardContent className="pt-6">
          <CreateFolderForm />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Links</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {folders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No folders yet — create one above.
                  </TableCell>
                </TableRow>
              )}
              {folders.map((f) => (
                <TableRow key={f.name}>
                  <TableCell>
                    <Link
                      className="font-medium underline-offset-4 hover:underline"
                      href={`/dashboard/folders/${encodeURIComponent(f.name)}`}
                    >
                      {f.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <TagBadges tags={f.tags} />
                  </TableCell>
                  <TableCell>{formatBytes(f.size)}</TableCell>
                  <TableCell className="space-x-3 font-mono text-xs">
                    <a
                      className="underline-offset-4 hover:underline"
                      href={`${GATEWAY}/ipfs/${f.rootCid}/`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      /ipfs (this version)
                    </a>
                    {f.ipnsName && (
                      <a
                        className="underline-offset-4 hover:underline"
                        href={`${GATEWAY}/ipns/${f.ipnsName}/`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        /ipns (latest)
                      </a>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <form action={deleteFolderAction}>
                      <input type="hidden" name="name" value={f.name} />
                      <Button variant="destructive" size="sm" type="submit">
                        Delete
                      </Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
```

(If `formatBytes` does not exist in `@/lib/format`, use whatever byte formatter the Files page uses — match it exactly rather than inventing one.)

- [ ] **Step 4: Create `apps/web/app/dashboard/folders/[name]/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { TagBadges } from "@/components/tag-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { deleteFolderEntryAction } from "@/lib/actions";
import { getFolder } from "@/lib/api";
import { formatBytes } from "@/lib/format";

const GATEWAY = process.env.IPFS_GATEWAY_URL ?? "http://localhost:8081";

export const dynamic = "force-dynamic";

export default async function FolderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ path?: string }>;
}) {
  const { name } = await params;
  const { path = "" } = await searchParams;
  const folder = await getFolder(decodeURIComponent(name), path);
  if (!folder) notFound();

  const crumbs = path ? path.split("/") : [];
  const base = `/dashboard/folders/${encodeURIComponent(folder.name)}`;

  return (
    <>
      <PageHeader
        title={folder.name}
        description={`Latest root ${folder.rootCid} — every change re-pins a new root and updates the /ipns/ pointer.`}
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <TagBadges tags={folder.tags} />
        <span className="text-muted-foreground">{formatBytes(folder.size)}</span>
        <a
          className="font-mono text-xs underline-offset-4 hover:underline"
          href={`${GATEWAY}/ipfs/${folder.rootCid}/`}
          target="_blank"
          rel="noreferrer"
        >
          /ipfs (this version)
        </a>
        {folder.ipnsName && (
          <a
            className="font-mono text-xs underline-offset-4 hover:underline"
            href={`${GATEWAY}/ipns/${folder.ipnsName}/`}
            target="_blank"
            rel="noreferrer"
          >
            /ipns (latest)
          </a>
        )}
      </div>

      <nav className="text-sm text-muted-foreground">
        <Link className="hover:underline" href={base}>
          {folder.name}
        </Link>
        {crumbs.map((seg, i) => {
          const sub = crumbs.slice(0, i + 1).join("/");
          return (
            <span key={sub}>
              {" / "}
              <Link
                className="hover:underline"
                href={`${base}?path=${encodeURIComponent(sub)}`}
              >
                {seg}
              </Link>
            </span>
          );
        })}
      </nav>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>CID</TableHead>
                <TableHead>Size</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {folder.entries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    Empty.
                  </TableCell>
                </TableRow>
              )}
              {folder.entries.map((entry) => {
                const entryPath = path ? `${path}/${entry.name}` : entry.name;
                return (
                  <TableRow key={entry.name}>
                    <TableCell>
                      {entry.type === "dir" ? (
                        <Link
                          className="font-medium underline-offset-4 hover:underline"
                          href={`${base}?path=${encodeURIComponent(entryPath)}`}
                        >
                          {entry.name}/
                        </Link>
                      ) : (
                        <a
                          className="underline-offset-4 hover:underline"
                          href={`${GATEWAY}/ipfs/${folder.rootCid}/${entryPath}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {entry.name}
                        </a>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {entry.cid}
                    </TableCell>
                    <TableCell>{formatBytes(entry.size)}</TableCell>
                    <TableCell className="text-right">
                      <form action={deleteFolderEntryAction}>
                        <input type="hidden" name="name" value={folder.name} />
                        <input type="hidden" name="path" value={entryPath} />
                        <Button variant="ghost" size="sm" type="submit">
                          Remove
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
```

- [ ] **Step 5: Gates + commit**

```bash
pnpm exec biome check --write apps/web
pnpm --filter web check-types
git add apps/web/app/dashboard/folders apps/web/components/create-folder-form.tsx apps/web/components/app-sidebar.tsx
git commit -m "feat(web): Folders pages — list/create/delete + browsable tree with gateway links"
```

---

### Task 9: Upload form — multi-select with folder/individual mode

**Files:**
- Modify: `apps/web/app/dashboard/upload/page.tsx` (full rewrite of the form component)

**Interfaces:**
- Consumes: `testUpload` (existing), `ensureFolder`, `uploadFolderFile`, `FolderUploadResult` (Task 7), `MAX_UPLOAD_BYTES`/`MAX_UPLOAD_MB`.
- Produces: UI behavior — mode radio (`individual` | `folder`); in folder mode: folder-name input, tags apply to the folder, optional directory picking (`webkitdirectory`), relative paths from `file.webkitRelativePath || file.name`, one request per file with `commit=false` on all but the last.

- [ ] **Step 1: Rewrite `apps/web/app/dashboard/upload/page.tsx`**

Replace the whole file with:

```tsx
"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ensureFolder,
  type FolderUploadResult,
  testUpload,
  type UploadResult,
  uploadFolderFile,
} from "@/lib/actions";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/upload-config";

type Mode = "individual" | "folder";

/** Relative path for a picked file: directory picks carry webkitRelativePath. */
function relPath(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string })
    .webkitRelativePath;
  return rel && rel.length > 0 ? rel : file.name;
}

export default function UploadPage() {
  const [mode, setMode] = useState<Mode>("individual");
  const [pickDirectory, setPickDirectory] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [folderResults, setFolderResults] = useState<FolderUploadResult[]>([]);
  const [pending, setPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const apiKey = String(formData.get("apiKey") ?? "");
    const tags = String(formData.get("tags") ?? "");
    const folder = String(formData.get("folder") ?? "").trim();
    const files = (formData.getAll("file") as unknown[]).filter(
      (f): f is File => f instanceof File && f.size > 0,
    );

    if (!apiKey) {
      toast.error("API key required");
      return;
    }
    if (files.length === 0) {
      toast.error("Choose at least one file");
      return;
    }
    if (mode === "folder" && !folder) {
      toast.error("Folder name required in folder mode");
      return;
    }

    const oversized = files.filter((f) => f.size > MAX_UPLOAD_BYTES);
    if (oversized.length > 0) {
      toast.error(
        `${oversized.length} file(s) exceed the ${MAX_UPLOAD_MB} MB limit and were skipped`,
      );
    }
    const toUpload = files.filter((f) => f.size <= MAX_UPLOAD_BYTES);
    if (toUpload.length === 0) return;

    setPending(true);
    setResults([]);
    setFolderResults([]);

    if (mode === "individual") {
      // One request per file so each file gets its own body-size budget.
      const settled = await Promise.all(
        toUpload.map((file) => {
          const fd = new FormData();
          fd.append("apiKey", apiKey);
          fd.append("tags", tags);
          fd.append("file", file, file.name);
          return testUpload(fd);
        }),
      );
      setResults(settled);
      const ok = settled.filter((r) => r.cid).length;
      if (ok > 0) toast.success(`Pinned ${ok} file(s) across the cluster`);
      if (settled.length - ok > 0)
        toast.error(`${settled.length - ok} file(s) failed`);
    } else {
      // Folder mode: create-or-reuse the folder, then upload sequentially —
      // commit=false on all but the last file so the batch lands as ONE new
      // folder version (one pin + one IPNS update).
      const create = new FormData();
      create.append("apiKey", apiKey);
      create.append("folder", folder);
      create.append("tags", tags);
      const created = await ensureFolder(create);
      if (!created.ok) {
        setPending(false);
        toast.error(created.error ?? "Folder create failed");
        return;
      }
      const settled: FolderUploadResult[] = [];
      for (const [i, file] of toUpload.entries()) {
        const fd = new FormData();
        fd.append("apiKey", apiKey);
        fd.append("folder", folder);
        fd.append("path", relPath(file));
        fd.append("commit", i === toUpload.length - 1 ? "true" : "false");
        fd.append("file", file, file.name);
        settled.push(await uploadFolderFile(fd));
      }
      setFolderResults(settled);
      const ok = settled.filter((r) => r.ok).length;
      const root = settled[settled.length - 1]?.rootCid;
      if (ok > 0)
        toast.success(
          `Added ${ok} file(s) to '${folder}'${root ? ` — new root ${root}` : ""}`,
        );
      if (settled.length - ok > 0)
        toast.error(`${settled.length - ok} file(s) failed`);
    }
    setPending(false);
  }

  return (
    <>
      <PageHeader
        title="Test Upload"
        description="A developer aid: push files through the same API-key-gated ingest paths machine clients use — as individual pins, or into a mutable folder."
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">Upload &amp; pin</CardTitle>
          <CardDescription>
            Requires an active API key from the API Keys page. Select one or
            more files — up to {MAX_UPLOAD_MB} MB each.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="apiKey">API key</Label>
              <Input id="apiKey" name="apiKey" placeholder="eco_…" required />
            </div>

            <fieldset className="space-y-2">
              <Label>Pin as</Label>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === "individual"}
                    onChange={() => setMode("individual")}
                  />
                  Individual files
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === "folder"}
                    onChange={() => setMode("folder")}
                  />
                  Folder
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                {mode === "individual"
                  ? "Each file becomes its own pin, exactly like the machine /ingest path."
                  : "Files land in one mutable folder: a single pin, a browsable /ipfs/ directory, and a stable /ipns/ URL."}
              </p>
            </fieldset>

            {mode === "folder" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="folder">Folder name</Label>
                  <Input
                    id="folder"
                    name="folder"
                    placeholder="e.g. photos-2026"
                    pattern="[a-z0-9][a-z0-9-]{0,63}"
                    title="lowercase letters, digits and dashes"
                  />
                  <p className="text-xs text-muted-foreground">
                    Created if it doesn't exist; otherwise files are added to
                    it.
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={pickDirectory}
                    onChange={(e) => {
                      setPickDirectory(e.target.checked);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                  />
                  Pick a whole directory (keeps its structure)
                </label>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="file">Files</Label>
              <Input
                key={mode === "folder" && pickDirectory ? "dir" : "files"}
                id="file"
                name="file"
                type="file"
                multiple
                required
                ref={fileInputRef}
                {...(mode === "folder" && pickDirectory
                  ? ({ webkitdirectory: "" } as Record<string, string>)
                  : {})}
              />
              <p className="text-xs text-muted-foreground">
                Max {MAX_UPLOAD_MB} MB per file. Batch uploads supported.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tags">Tags (optional)</Label>
              <Input id="tags" name="tags" placeholder="e.g. photos,archive" />
              <p className="text-xs text-muted-foreground">
                {mode === "folder"
                  ? "Tags apply to the folder: participants subscribed to one of them replicate the whole folder."
                  : "Tagged content is replicated by the main node and participants subscribed to one of its tags."}
              </p>
            </div>

            <Button type="submit" disabled={pending}>
              {pending ? "Uploading…" : "Upload & pin"}
            </Button>
          </form>

          {results.length > 0 && (
            <div className="mt-4 space-y-3">
              {results.map((r) => (
                <div key={`${r.name}-${r.cid ?? r.error}`}>
                  <p className="mb-1 text-sm text-muted-foreground break-all">
                    {r.name}
                  </p>
                  {r.cid ? (
                    <div className="rounded-md bg-muted px-3 py-2 font-mono text-sm break-all">
                      {r.cid}
                    </div>
                  ) : (
                    <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive break-all">
                      {r.error ?? "upload failed"}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {folderResults.length > 0 && (
            <div className="mt-4 space-y-1">
              {folderResults.map((r) => (
                <p
                  key={r.path}
                  className={`text-sm break-all ${r.ok ? "text-muted-foreground" : "text-destructive"}`}
                >
                  {r.ok ? "✓" : "✗"} {r.path}
                  {r.error ? ` — ${r.error}` : ""}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
```

- [ ] **Step 2: Gates + commit**

```bash
pnpm exec biome check --write apps/web
pnpm --filter web check-types
git add apps/web/app/dashboard/upload/page.tsx
git commit -m "feat(web): upload form — multi-select with folder vs individual-pins mode"
```

---

### Task 10: End-to-end smoke test + full gates

**Files:**
- No new files; manual verification against the dev stack.

- [ ] **Step 1: Full test + type + lint gates across the repo**

```bash
pnpm --filter api test
pnpm --filter web test
pnpm --filter api check-types
pnpm --filter web check-types
pnpm exec biome check apps/api apps/web docker-compose.yml
```

Expected: all PASS, no lint diagnostics.

- [ ] **Step 2: Live smoke test against dev infra**

```bash
docker compose up -d   # postgres, kubo (now with 127.0.0.1:5001), cluster
pnpm dev               # api :8080 + web :3000 (run in background)
```

Then exercise the machine path end-to-end (needs an API key from the dashboard, or insert one; the dashboard flow works too):

```bash
# create a folder
curl -s -X POST localhost:8080/folders -H "x-api-key: $KEY" \
  -H 'content-type: application/json' -d '{"name":"smoke","tags":[]}'
# expect {"name":"smoke","rootCid":"bafy…","ipnsName":"k51…"}

# upload two files, one commit
echo hello > /tmp/a.txt; echo world > /tmp/b.txt
curl -s -X POST "localhost:8080/folders/smoke/files?commit=false" \
  -H "x-api-key: $KEY" -F file=@/tmp/a.txt -F path=a.txt
curl -s -X POST "localhost:8080/folders/smoke/files" \
  -H "x-api-key: $KEY" -F file=@/tmp/b.txt -F path=sub/b.txt

# list + verify the tree
curl -s "localhost:8080/folders/smoke" -H "x-api-key: $KEY"
# expect entries a.txt + sub/, and a rootCid R

# gateway checks (replace R / K from the responses)
curl -s "http://localhost:8081/ipfs/R/sub/b.txt"   # → world
curl -s "http://localhost:8081/ipns/K/a.txt"       # → hello (IPNS resolves)
```

Also verify in the browser: `/dashboard/folders` lists `smoke` with working `/ipfs` + `/ipns` links; the upload page folder mode adds files; the Files page still works.

- [ ] **Step 3: Commit any smoke-test fixes, then hand off**

Fix whatever the smoke test surfaces (each fix: failing test first where feasible, then the fix, then re-run gates). When green, this plan is complete — use superpowers:finishing-a-development-branch to merge/PR `feat/mfs-folders-ipns`.
```
