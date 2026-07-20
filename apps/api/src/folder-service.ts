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
 *
 * Every folder root also carries a `.econome` marker file (content = the
 * folder name) so two folders with identical content (e.g. two empty
 * folders) never flush to the same root CID — cluster pins are keyed by
 * CID, so a collision would make the second pin overwrite the first
 * folder's metadata (tags + folder key lost).
 *
 * The per-folder queue (`queues`) is in-process: the design assumes a
 * single API instance.
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
/**
 * Root-uniqueness marker: written into every folder as `<root>/.econome`
 * with the folder name as its content. Reserved — never user-writable.
 */
export const FOLDER_MARKER = ".econome";

const FOLDER_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isValidFolderName(name: string): boolean {
  return FOLDER_NAME_RE.test(name);
}

/** Relative path inside a folder: non-empty slash-separated segments, no traversal. */
export function isValidRelPath(path: string): boolean {
  if (path.length === 0 || path.length > 1024) return false;
  if (path.includes("\\")) return false;
  const segments = path.split("/");
  if (segments[0] === FOLDER_MARKER) return false;
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
      await this.ensureMarker(name);
      const rootCid = await this.commit(name, tags);
      return { name, rootCid, ipnsName };
    });
  }

  /**
   * Write the `.econome` marker (content = folder name) if it isn't already
   * there. Its content is what makes every folder's root CID unique — two
   * folders with identical content would otherwise flush to the same CID.
   * `filesCp` to an existing path errors in kubo, so this checks first.
   */
  private async ensureMarker(name: string): Promise<void> {
    const markerPath = this.mfsPath(name, FOLDER_MARKER);
    try {
      await this.deps.kubo.filesStat(markerPath);
      return; // already there
    } catch (err) {
      if (!notFound(err)) throw err;
    }
    const markerCid = await this.deps.kubo.addFile(
      new Blob([name]),
      FOLDER_MARKER,
    );
    await this.deps.kubo.filesCp(`/ipfs/${markerCid}`, markerPath);
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
      entries = (await this.deps.kubo.filesLs(this.mfsPath(name, path))).filter(
        (e) => e.name !== FOLDER_MARKER,
      );
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

  private assertFolderName(name: string) {
    if (!isValidFolderName(name))
      throw new Error(`invalid folder name: ${name}`);
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
  ): Promise<{
    added: { path: string; cid: string }[];
    rootCid: string | null;
  }> {
    this.assertFolderName(name);
    for (const f of files) this.assertRelPath(f.path);
    return this.enqueue(name, async () => {
      await this.assertExists(name);
      const added: { path: string; cid: string }[] = [];
      for (const f of files) {
        const base = f.path.split("/").pop() ?? f.path;
        const cid = await this.deps.kubo.addFile(f.content, base);
        await this.deps.kubo.filesCp(
          `/ipfs/${cid}`,
          this.mfsPath(name, f.path),
        );
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
        await this.deps.kubo.filesCp(
          `/ipfs/${e.cid}`,
          this.mfsPath(name, e.path),
        );
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
      // Unlike files/cp, kubo's files/mv has no `parents` option — the
      // destination directory must already exist or the move 500s.
      const toDir = to.includes("/") ? to.slice(0, to.lastIndexOf("/")) : "";
      if (toDir) await this.deps.kubo.filesMkdir(this.mfsPath(name, toDir));
      await this.deps.kubo.filesMv(
        this.mfsPath(name, from),
        this.mfsPath(name, to),
      );
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
      await this.deps.cluster.pinByCid(
        rootCid,
        await this.pinOptions(name, tags),
      );
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
      try {
        await this.enqueue(dir.name, async () => {
          const rootCid = await this.deps.kubo.filesFlush(
            this.mfsPath(dir.name),
          );
          const mine = this.folderPins(pins, dir.name);
          const drifted = !mine.some((p) => p.cid === rootCid);
          const stale = mine.filter((p) => p.cid !== rootCid);
          if (drifted) {
            const tags = mine[0]
              ? (parseTags(mine[0].metadata[TAGS_META_KEY]) ?? [])
              : [];
            await this.deps.cluster.pinByCid(
              rootCid,
              await this.pinOptions(dir.name, tags),
            );
            repinned += 1;
          }
          // Publish whenever the IPNS record might be stale — not just on a
          // drifted root: a crash between pin and publish leaves the stale
          // pins present but IPNS already pointing elsewhere, or the record
          // never updated. Publish BEFORE releasing the stale pins so the
          // name never points at content about to be unpinned.
          if (drifted || stale.length > 0) {
            await this.deps.kubo.namePublish(
              `${KEY_PREFIX}${dir.name}`,
              `/ipfs/${rootCid}`,
            );
          }
          for (const s of stale) {
            await this.deps.cluster
              .unpin(s.cid)
              .catch((err) => this.log(`reconcile unpin ${s.cid}: ${err}`));
            cleaned += 1;
          }
        });
      } catch (err) {
        this.log(`reconcile of ${dir.name} failed: ${err}`);
      }
    }

    const names = new Set(dirs.map((d) => d.name));
    for (const pin of pins) {
      const folder = pin.metadata[FOLDER_META_KEY];
      if (!folder || names.has(folder)) continue;
      // The `dirs` listing was taken at sweep start; a folder created
      // mid-sweep won't be in it yet. Re-check right before unpinning so we
      // never release a root a concurrent create() just pinned.
      try {
        await this.deps.kubo.filesStat(this.mfsPath(folder));
        continue; // folder exists now — not actually orphaned
      } catch (err) {
        if (!notFound(err)) {
          this.log(`reconcile orphan check ${folder} failed: ${err}`);
          continue;
        }
      }
      await this.deps.cluster
        .unpin(pin.cid)
        .catch((err) => this.log(`reconcile orphan unpin ${pin.cid}: ${err}`));
      cleaned += 1;
    }
    return { repinned, cleaned };
  }
}
