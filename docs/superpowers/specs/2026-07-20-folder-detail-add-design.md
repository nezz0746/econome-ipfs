# Folder Detail: Upload Files + Add by CID

**Date:** 2026-07-20
**Status:** Approved

## Goal

Let dashboard users add content to an existing folder from the folder detail
page — today the page only offers per-entry Remove, and the only way to add
files is the Test Upload form (which requires pasting an API key).

## Decisions (locked)

| Question | Decision |
|---|---|
| Operations | **Upload files here** (at the currently browsed path) and **Add by CID**. Not in scope: new-subfolder button, rename/move UI. |
| Transport | Session-gated server actions calling the existing internal mount (`/cluster/folders/:name/files`, `/cluster/folders/:name/cids`) with the internal token. No API key in the UI. |
| Rejected | Reusing the API-key path (clunky) and direct browser→API calls (CORS + credential exposure). |
| API changes | None — both endpoints already exist and are tested. |

## Architecture

### BFF client (`apps/web/lib/api.ts`)

- `uploadFolderFileInternal(name: string, file: File, path: string, commit: boolean): Promise<{ rootCid: string | null }>` — multipart POST to
  `${HONO_URL}/cluster/folders/<name>/files?commit=<bool>` with the
  `x-internal-token` header and paired `file` + `path` fields. Gets its own
  fetch (the existing `gatewayMutate` helper assumes JSON bodies).
- `addFolderCids(name: string, entries: { cid: string; path: string }[]): Promise<{ rootCid: string }>` — reuses `gatewayMutate` against
  `/folders/<name>/cids`.

### Server actions (`apps/web/lib/actions.ts`)

Both session-gated via `requireUserId()` and returning `{ok, error?}` rather
than throwing (production Next.js redacts thrown server-action messages).

- `uploadFolderEntry(formData)` — fields `name`, `path` (FULL relative path
  including the currently browsed directory), `commit` ("true"/"false"),
  `file`. Enforces `MAX_UPLOAD_BYTES` per file. One file per request so each
  call stays under the 12 MB server-action body budget. Returns
  `{ path, ok, error?, rootCid? }`.
- `addCidToFolderAction(formData)` — fields `name`, `cid`, `path`. Calls
  `addFolderCids` with a single entry, then
  `revalidatePath("/dashboard/folders/<name>")`. Returns `{ ok, error? }`.

### UI (`apps/web/components/folder-add-controls.tsx` + detail page)

New client component `FolderAddControls`, rendered on
`apps/web/app/dashboard/folders/[name]/page.tsx` between the breadcrumbs and
the entries table, receiving `folderName` and `currentPath` props. Two
side-by-side controls (cards or a compact row, following the page's existing
component style):

- **Upload files**: multi-file input + "Add to folder" button. On submit:
  filter oversize files (reuse the `MAX_UPLOAD_BYTES` skip + toast pattern),
  then send sequentially — `commit=false` on all but the last file,
  `commit=true` on the last — so the whole batch lands as ONE new folder
  version (one pin + one IPNS update; the API-side reconcile heals an
  interrupted batch). Destination path per file:
  `currentPath ? `${currentPath}/${file.name}` : file.name`.
- **Add by CID**: two inputs — CID and a name/path for it in the folder —
  plus a button. Destination = `currentPath/<given name>`. Single request.

Both: success/failure toasts, `router.refresh()` on completion so the server
component re-renders the new tree, and `pending` state wrapped in
try/finally so a transport-level rejection can never leave the buttons stuck
disabled.

## Error handling

Service-level failures (invalid path, folder not found, oversized, cluster
errors) surface as `{ok: false, error}` from the actions and are toasted.
No optimistic UI — the tree refreshes only after the API confirms.

## Testing

- No page unit tests (repo convention): gates are the verification —
  `pnpm exec biome check`, `pnpm --filter web check-types`,
  `pnpm --filter web build`.
- The API endpoints are already covered by `apps/api/test/app.test.ts`
  (upload with paths + `?commit=false`, cids mount) — no API changes.
- Live smoke: with the dev stack up, add a file and mount a CID through the
  internal mount exactly as the actions do (curl with `x-internal-token`),
  then confirm the new entries appear in `GET /cluster/folders/<name>`.

## Out of scope

- New-subfolder button, rename/move UI (future work; API already supports
  move).
- Progress bars / drag-and-drop upload affordances.
- Changes to the Test Upload form or the machine API.
