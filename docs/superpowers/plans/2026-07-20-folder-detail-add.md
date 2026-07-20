# Folder Detail Upload + Add-by-CID Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let dashboard users upload files and mount existing CIDs into a folder from the folder detail page, at the currently browsed path, with no API key.

**Architecture:** Two new session-gated server actions call the API's existing internal mount (`/cluster/folders/:name/files` and `/cluster/folders/:name/cids`) with the internal token. A new `FolderAddControls` client component on the detail page sends files sequentially with `commit=false` on all but the last (one folder version per batch) and refreshes the tree on completion. No API changes.

**Tech Stack:** Next.js App Router server actions, existing Hono internal mount, sonner toasts, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-07-20-folder-detail-add-design.md`

## Global Constraints

- Branch: `feat/folder-detail-add` (off `main`; already created — work on it).
- No API (`apps/api`) changes — both endpoints exist and are tested.
- Actions return `{ok, error?}` — never throw for expected failures (prod Next.js redacts thrown server-action messages).
- Per-file cap: reuse `MAX_UPLOAD_BYTES`/`MAX_UPLOAD_MB` from `@/lib/upload-config`; oversize files are skipped with a toast, batch continues.
- Batch protocol: sequential per-file requests, `commit="false"` on all but the LAST file, `"true"` on the last — one new folder version per batch.
- Destination path per file: `currentPath ? \`${currentPath}/${file.name}\` : file.name`.
- `pending` state must be wrapped in try/finally — a transport-level rejection can never leave buttons stuck disabled.
- TypeScript strict + `noUncheckedIndexedAccess`. No page unit tests (repo convention) — gates + `pnpm --filter web build` are the verification.
- Gates per commit: `pnpm exec biome check --write apps/web`, `pnpm --filter web check-types`. Node ≥ 22 (`nvm use 22` if needed).
- Every commit message ends with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: BFF helpers + server actions

**Files:**
- Modify: `apps/web/lib/api.ts` (append two functions)
- Modify: `apps/web/lib/actions.ts` (append two actions; extend the `@/lib/api` import)

**Interfaces:**
- Consumes: existing `HONO_URL`, `INTERNAL_TOKEN`, `gatewayMutate` (module-private, in api.ts); existing `requireUserId`, `revalidatePath`, `FolderUploadResult`, `MAX_UPLOAD_BYTES`, `MAX_UPLOAD_MB` (actions.ts).
- Produces (used by Task 2):
  ```ts
  // lib/api.ts
  export function uploadFolderFileInternal(name: string, file: File, path: string, commit: boolean): Promise<{ rootCid: string | null }>
  export function addFolderCids(name: string, entries: { cid: string; path: string }[]): Promise<{ rootCid: string }>
  // lib/actions.ts
  export async function uploadFolderEntry(formData: FormData): Promise<FolderUploadResult>   // fields: name, path, commit, file
  export async function addCidToFolderAction(formData: FormData): Promise<{ ok: boolean; error?: string }>  // fields: name, cid, path
  ```

- [ ] **Step 1: Append to `apps/web/lib/api.ts`** (after the existing folders section)

```ts
/**
 * Upload one file into a folder through the internal (session-gated BFF)
 * mount — no API key. Multipart, so it gets its own fetch: gatewayMutate
 * assumes JSON bodies. Chunked-batch protocol: callers pass commit=false
 * for all but the final file so the batch lands as one folder version.
 */
export async function uploadFolderFileInternal(
  name: string,
  file: File,
  path: string,
  commit: boolean,
): Promise<{ rootCid: string | null }> {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("path", path);
  const res = await fetch(
    `${HONO_URL}/cluster/folders/${encodeURIComponent(name)}/files?commit=${commit}`,
    {
      method: "POST",
      headers: { "x-internal-token": INTERNAL_TOKEN },
      body: form,
      cache: "no-store",
    },
  );
  if (!res.ok) {
    throw new Error(`Folder upload failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { rootCid: string | null };
  return { rootCid: body.rootCid };
}

/** Mount existing CIDs into a folder via the internal mount. */
export function addFolderCids(
  name: string,
  entries: { cid: string; path: string }[],
): Promise<{ rootCid: string }> {
  return gatewayMutate<{ rootCid: string }>(
    `/folders/${encodeURIComponent(name)}/cids`,
    { method: "POST", body: JSON.stringify({ entries }) },
  );
}
```

- [ ] **Step 2: Append to `apps/web/lib/actions.ts`** (extend the existing `@/lib/api` import with `addFolderCids, uploadFolderFileInternal`)

```ts
/**
 * Upload one file of a folder-detail batch through the internal mount (no
 * API key — gated on the dashboard session). One request per file so each
 * stays under the server-action body budget; callers send commit=false on
 * all but the last file.
 */
export async function uploadFolderEntry(
  formData: FormData,
): Promise<FolderUploadResult> {
  await requireUserId();
  const name = String(formData.get("name") ?? "");
  const path = String(formData.get("path") ?? "");
  const commit = String(formData.get("commit") ?? "true") === "true";
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { path, ok: false, error: "Empty file" };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { path, ok: false, error: `Too large (max ${MAX_UPLOAD_MB} MB)` };
  }
  try {
    const res = await uploadFolderFileInternal(name, file, path, commit);
    if (commit) {
      revalidatePath(`/dashboard/folders/${encodeURIComponent(name)}`);
    }
    return { path, ok: true, rootCid: res.rootCid };
  } catch (err) {
    return {
      path,
      ok: false,
      error: err instanceof Error ? err.message : "upload failed",
    };
  }
}

/** Mount an existing CID into a folder at the given relative path. */
export async function addCidToFolderAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await requireUserId();
  const name = String(formData.get("name") ?? "");
  const cid = String(formData.get("cid") ?? "").trim();
  const path = String(formData.get("path") ?? "").trim();
  if (!cid || !path) return { ok: false, error: "CID and name required" };
  try {
    await addFolderCids(name, [{ cid, path }]);
    revalidatePath(`/dashboard/folders/${encodeURIComponent(name)}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "add failed",
    };
  }
}
```

- [ ] **Step 3: Gates**

Run: `pnpm exec biome check --write apps/web && pnpm --filter web check-types`
Expected: both clean (these are thin wrappers; gates are the verification per repo convention)

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/api.ts apps/web/lib/actions.ts
git commit -m "feat(web): internal-mount folder upload + add-by-CID actions"
```

---

### Task 2: `FolderAddControls` component + detail-page wiring

**Files:**
- Create: `apps/web/components/folder-add-controls.tsx`
- Modify: `apps/web/app/dashboard/folders/[name]/page.tsx` (import + render between the breadcrumb `<nav>` and the entries `<Card>`)

**Interfaces:**
- Consumes: `uploadFolderEntry`, `addCidToFolderAction`, `FolderUploadResult` (Task 1, from `@/lib/actions`); `MAX_UPLOAD_BYTES`, `MAX_UPLOAD_MB` (`@/lib/upload-config`); shadcn `Button`, `Card`, `CardContent`, `Input`, `Label`; `toast` (sonner); `useRouter` (`next/navigation`).
- Produces: `export function FolderAddControls({ folderName, currentPath }: { folderName: string; currentPath: string })`.

- [ ] **Step 1: Create `apps/web/components/folder-add-controls.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addCidToFolderAction, uploadFolderEntry } from "@/lib/actions";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/upload-config";

/**
 * Add content to a folder at the currently browsed path: upload files
 * (session-gated, no API key) or mount an existing CID. Uploads batch as
 * ONE folder version: commit=false on all but the last file.
 */
export function FolderAddControls({
  folderName,
  currentPath,
}: {
  folderName: string;
  currentPath: string;
}) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [addingCid, setAddingCid] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const destPath = (leaf: string) =>
    currentPath ? `${currentPath}/${leaf}` : leaf;

  async function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const files = Array.from(fileInputRef.current?.files ?? []).filter(
      (f) => f.size > 0,
    );
    if (files.length === 0) {
      toast.error("Choose at least one file");
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

    setUploading(true);
    try {
      let failed = 0;
      for (const [i, file] of toUpload.entries()) {
        const fd = new FormData();
        fd.append("name", folderName);
        fd.append("path", destPath(file.name));
        fd.append("commit", i === toUpload.length - 1 ? "true" : "false");
        fd.append("file", file, file.name);
        const res = await uploadFolderEntry(fd);
        if (!res.ok) {
          failed += 1;
          toast.error(`${file.name}: ${res.error ?? "upload failed"}`);
        }
      }
      const ok = toUpload.length - failed;
      if (ok > 0) toast.success(`Added ${ok} file(s) to '${folderName}'`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  async function onAddCid(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const leaf = String(fd.get("entryName") ?? "").trim();
    const payload = new FormData();
    payload.append("name", folderName);
    payload.append("cid", String(fd.get("cid") ?? ""));
    payload.append("path", leaf ? destPath(leaf) : "");
    setAddingCid(true);
    try {
      const res = await addCidToFolderAction(payload);
      if (res.ok) {
        toast.success("CID mounted into the folder");
        form.reset();
        router.refresh();
      } else {
        toast.error(res.error ?? "add failed");
      }
    } finally {
      setAddingCid(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-x-8 gap-y-4 pt-6">
        <form onSubmit={onUpload} className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="folder-add-files">
              Upload {currentPath ? `into ${currentPath}/` : "files"}
            </Label>
            <Input
              id="folder-add-files"
              type="file"
              multiple
              ref={fileInputRef}
            />
            <p className="text-xs text-muted-foreground">
              Max {MAX_UPLOAD_MB} MB per file. The batch lands as one new
              folder version.
            </p>
          </div>
          <Button type="submit" disabled={uploading}>
            {uploading ? "Uploading…" : "Add to folder"}
          </Button>
        </form>

        <form onSubmit={onAddCid} className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="folder-add-cid">Add existing CID</Label>
            <Input
              id="folder-add-cid"
              name="cid"
              placeholder="bafy…"
              className="font-mono"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="folder-add-cid-name">Name in folder</Label>
            <Input
              id="folder-add-cid-name"
              name="entryName"
              placeholder="e.g. archive.tar"
              required
            />
          </div>
          <Button type="submit" variant="secondary" disabled={addingCid}>
            {addingCid ? "Adding…" : "Mount CID"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Wire into `apps/web/app/dashboard/folders/[name]/page.tsx`**

Add the import:

```ts
import { FolderAddControls } from "@/components/folder-add-controls";
```

and directly after the closing `</nav>` of the breadcrumb block (before the entries `<Card>`), add:

```tsx
      <FolderAddControls folderName={folder.name} currentPath={path} />
```

- [ ] **Step 3: Gates + build**

```bash
pnpm exec biome check --write apps/web
pnpm --filter web check-types
pnpm --filter web build
```

Expected: all clean; build succeeds with `/dashboard/folders/[name]` still dynamic.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/folder-add-controls.tsx "apps/web/app/dashboard/folders/[name]/page.tsx"
git commit -m "feat(web): upload files + mount CIDs from the folder detail page"
```

---

### Task 3: Full gates + live smoke

**Files:** none (verification only; commit fixes only if the smoke surfaces issues).

- [ ] **Step 1: Full gates**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
pnpm --filter web test        # 15 passing
pnpm --filter api test        # 151 passing (untouched)
pnpm --filter web check-types && pnpm --filter api check-types
pnpm exec biome check apps/web
```

- [ ] **Step 2: Live smoke (exactly what the actions do, via curl)**

With dev infra up (`docker compose up -d`) and the API running (`nohup pnpm --filter api dev > /tmp/econome-api-dev.log 2>&1 &`, wait for `curl -s localhost:8080/health`):

```bash
T='x-internal-token: dev-internal-token'
# create a folder via the internal mount
curl -s -X POST localhost:8080/cluster/folders -H "$T" -H 'content-type: application/json' -d '{"name":"ui-smoke","tags":[]}'
# upload two files as one version (commit=false then commit=true) — the action's exact requests
echo one > /tmp/u1.txt; echo two > /tmp/u2.txt
curl -s -X POST "localhost:8080/cluster/folders/ui-smoke/files?commit=false" -H "$T" -F file=@/tmp/u1.txt -F path=u1.txt
curl -s -X POST "localhost:8080/cluster/folders/ui-smoke/files?commit=true"  -H "$T" -F file=@/tmp/u2.txt -F path=docs/u2.txt
# mount an existing CID (use u1's cid from the first response) at a path
curl -s -X POST localhost:8080/cluster/folders/ui-smoke/cids -H "$T" -H 'content-type: application/json' -d '{"entries":[{"cid":"<CID_OF_U1>","path":"copies/u1-again.txt"}]}'
# verify the tree contains u1.txt, docs/, copies/
curl -s "localhost:8080/cluster/folders/ui-smoke" -H "$T"
# cleanup
curl -s -X DELETE localhost:8080/cluster/folders/ui-smoke -H "$T"
rm /tmp/u1.txt /tmp/u2.txt
```

Then kill the dev API process (`lsof -ti :8080 | xargs kill`).

- [ ] **Step 3: Hand off**

When green, use superpowers:finishing-a-development-branch for `feat/folder-detail-add` (PR to `main`).
