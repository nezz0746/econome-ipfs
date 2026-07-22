import { readFile } from "node:fs/promises";
import type { SiteFile } from "./site.js";

export interface FolderSummary {
  name: string;
  rootCid: string;
  ipnsName: string | null;
  size: number;
  tags: string[];
}

export interface AddFilesResult {
  added: { path: string; cid: string }[];
  rootCid: string | null;
}

export class FoldersApi {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
  ) {}

  private async request<T>(
    path: string,
    init: RequestInit & { body?: BodyInit },
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.apiUrl}${path}`, {
        ...init,
        headers: { ...(init.headers ?? {}), "x-api-key": this.apiKey },
      });
    } catch (err) {
      throw new Error(
        `Could not reach ${this.apiUrl}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(
        `${path} returned a non-JSON response (HTTP ${res.status}).`,
      );
    }

    if (!res.ok) {
      const message =
        body && typeof body === "object" && "error" in body
          ? String((body as { error: unknown }).error)
          : `HTTP ${res.status}`;
      throw new Error(`${path}: ${message}`);
    }
    return body as T;
  }

  /** Cheapest authenticated call; used to verify a key. */
  async list(): Promise<FolderSummary[]> {
    return this.request<FolderSummary[]>("/folders", { method: "GET" });
  }

  /** Create the folder, tolerating one that already exists. */
  async ensureFolder(name: string, tags: string[]): Promise<void> {
    try {
      await this.request("/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, tags }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Republishing to the same name is the normal case, not an error.
      if (/exists|409|conflict/i.test(message)) return;
      throw err;
    }
  }

  async get(name: string): Promise<FolderSummary | null> {
    try {
      return await this.request<FolderSummary>(
        `/folders/${encodeURIComponent(name)}`,
        { method: "GET" },
      );
    } catch (err) {
      if (/not found|404/i.test(err instanceof Error ? err.message : "")) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Upload one batch. `commit` is false for every batch but the last: each
   * commit republishes the IPNS name, so committing per batch would publish
   * a half-uploaded site and cost a needless republish per batch.
   */
  async addFiles(
    name: string,
    files: SiteFile[],
    commit: boolean,
  ): Promise<AddFilesResult> {
    const form = new FormData();
    for (const file of files) {
      const bytes = await readFile(file.absPath);
      form.append("file", new Blob([new Uint8Array(bytes)]), file.relPath);
      form.append("path", file.relPath);
    }
    return this.request<AddFilesResult>(
      `/folders/${encodeURIComponent(name)}/files?commit=${commit}`,
      { method: "POST", body: form },
    );
  }
}
