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
import type { KuboClient, MfsEntry, MfsStat } from "./kubo-client";
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
  return segments.every((s) => s.length > 0 && s !== "." && s !== "..");
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
   * MUST be the uncached ClusterClient: commit reads the pinset immediately
   * before pinning and on every successive commit, which the 15s dashboard
   * read-cache would serve stale.
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
    return relPath
      ? `${FOLDER_ROOT}/${name}/${relPath}`
      : `${FOLDER_ROOT}/${name}`;
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
    await this.deps.kubo.namePublish(
      `${KEY_PREFIX}${name}`,
      `/ipfs/${rootCid}`,
    );
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
    let stat: MfsStat;
    let entries: MfsEntry[];
    try {
      stat = await this.deps.kubo.filesStat(this.mfsPath(name));
      entries = await this.deps.kubo.filesLs(this.mfsPath(name, path));
    } catch (err) {
      if (notFound(err)) return null;
      throw err;
    }
    const [keys, pins] = await Promise.all([
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
  }
}
