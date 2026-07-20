# MFS Folders + IPNS Design

**Date:** 2026-07-20
**Status:** Approved

## Goal

Add mutable folders and stable IPFS-native URLs to the storage center. Today
every upload is a single-file UnixFS pin listed flat in the dashboard. This
design adds:

- **Folders** as real UnixFS directory DAGs — browsable on the gateway,
  replicated as one unit, mutable (add/remove/rename files after creation).
- **IPNS** — one permanent `/ipns/<key>` name per folder, always pointing at
  the folder's latest root CID.
- **Bulk upload** — upload many files at once, as a folder or as individual
  pins.
- **Dashboard hierarchy** — a Folders section with a browsable tree view.

## Decisions (locked)

| Question | Decision |
|---|---|
| Folder mutability | Mutable (Dropbox-like), not snapshots |
| Stable URLs | Real IPNS via Kubo keys; **no custom republish job** (Kubo's built-in republisher only) |
| Replication unit | The folder root pin. Files inside a folder are **not** separately cluster-pinned. Loose files keep working exactly as today. |
| DAG mechanism | Kubo **MFS** via the RPC API (`files/*`) |
| State | MFS + cluster pin metadata + Kubo keystore are the sources of truth. **Postgres is convenience only** (existing `uploads` rows for accounting/attribution; no new required tables). |

## Architecture

### Sources of truth (no new Postgres state)

- **Tree structure:** Kubo MFS under `/econome/<folderName>/...`. Nested
  directories allowed. Listing = `files/ls`, root CID = `files/stat`.
- **Tags / replication:** the folder's root CID is a normal cluster pin
  carrying tags in pin metadata (existing `TAGS_META_KEY`), plus a new
  `folder:<name>` meta key so folder pins are attributable and stale roots
  findable. `desiredAllocations()` and the reallocation job operate on it
  unchanged — followers subscribed to a tag replicate the whole folder
  recursively.
- **IPNS:** one ed25519 key per folder in Kubo's keystore
  (`key/gen econome-folder-<name>`); `key/list` recovers the name→key
  mapping. Publish with a generous `--lifetime` (168h). Kubo's built-in
  republisher (default ~4h interval) keeps records alive; no custom job.
- **Postgres:** only what already exists — `uploads` rows recorded per ingest
  for accounting/API-key attribution, with `name` = relative path inside the
  folder. No folders table. A DB mirror may be added later purely as a
  listing cache if Kubo round-trips become a bottleneck.

### The commit primitive

Every folder mutation ends with one sequence:

1. `files/flush` the folder path
2. `files/stat` → new root CID
3. Cluster-pin the new root (name = folder name, tags + `folder:<name>` meta,
   allocations computed from tags)
4. `name/publish --key=econome-folder-<name> --lifetime=168h /ipfs/<newRoot>`
5. Unpin the previous root from the cluster

The new root is pinned **before** the old root is released, so content is
never unprotected. Mutations are serialized per folder (in-process queue) to
prevent root races. A bulk upload commits **once** per request, not per file.

### API surface (Hono, `apps/api`)

Same auth model as today: API-key gated for machines, internal token for the
web BFF.

- `POST /folders` `{name, tags}` — `files/mkdir`, `key/gen`, pin the empty
  dir root, publish. Returns `{name, ipnsName, rootCid}`.
- `GET /folders` — list folders from `files/ls /econome` + per-folder
  `files/stat` (root, size) + `key/list` + cluster pin metadata (tags).
- `GET /folders/:name?path=` — tree listing at a path via `files/ls` (long
  form: names, CIDs, sizes, types).
- `POST /folders/:name/files` — multipart upload of one or more files with
  relative paths. Bytes go to Kubo `add?pin=false` (covered by the folder's
  recursive cluster pin), then `files/cp /ipfs/<cid> <dest>`, then one commit.
- `POST /folders/:name/cids` — mount already-known CIDs into the folder
  (`files/cp /ipfs/<cid>`), then commit.
- `POST /folders/:name/move` `{from, to}` — `files/mv`, commit.
- `DELETE /folders/:name/files/*path` — `files/rm -r`, commit.
- `PATCH /folders/:name` `{tags}` — re-pin the current root with new
  metadata/allocations (reuses existing reallocation logic), republish not
  required (root unchanged).
- `DELETE /folders/:name` — cluster-unpin root, `files/rm -r` the MFS dir,
  `key/rm` (the IPNS name is permanently retired — accepted trade-off).

### Web UI (`apps/web`)

- **Folders page** (new): table of folders — name, tags, size, file count,
  root CID, and two links: permanent-version `/ipfs/<root>/` and stable
  `/ipns/<key>/`. Create-folder dialog (name + tags).
- **Folder detail**: breadcrumbed tree view server-rendered from `files/ls`
  via the BFF; per-file gateway links `/ipfs/<root>/<path>`; upload-into,
  move, rename, delete actions.
- **Upload page (test form)**: gains multi-file selection (including
  directory selection via `webkitdirectory`) and a mode toggle:
  - **As folder** — target a new or existing folder; relative paths
    preserved; one commit for the whole batch.
  - **As individual files** — each file becomes its own pin exactly like
    today's single-file flow (loop over the existing ingest path).
- Loose single-file uploads and the existing Files page are unchanged.

### Error handling & drift

The commit sequence is not atomic. A **reconcile sweep** (on API boot +
periodic, alongside the accounting job) walks `/econome/*` and for each
folder compares the MFS root against (a) the cluster pin and (b) the IPNS
record, then re-pins / republishes / unpins orphaned old roots (found via the
`folder:<name>` pin metadata). **MFS always wins.** This one job covers every
crash-mid-commit case. Unpin failures in step 5 of the commit are logged and
left to the sweep.

### Infra prerequisite

- Set `IPFS_API_URL=http://kubo:5001` on the `api` service in
  `docker-compose.yml` and `docker-compose.prod.yml` (today it silently
  defaults to `localhost:5001`, which is wrong inside the container).
- Expose `127.0.0.1:5001:5001` on the `kubo` service in the **dev** compose
  so the host-run dev API reaches Kubo. Kubo's RPC API stays unpublished in
  prod.
- Gateway IPNS resolution (`/ipns/*` paths) is on by default in Kubo — no
  gateway change needed.

### Accounting

`pinSizes` and contribution snapshots operate on cluster pins, so folder
roots are included automatically. Per-ingest `uploads` rows continue to be
written for history/attribution (bookkeeping only, never authoritative).

## Testing

- Unit tests for the commit and reconcile orchestration against mocked
  Kubo/cluster clients (ordering: pin-new-before-unpin-old; single commit per
  batch; per-folder serialization).
- One integration test against the real dev-compose Kubo:
  mkdir → write → stat → pin → ls round-trip.
- Existing quality gates: strict TS + biome check + vitest in both apps.

## Out of scope

- Per-file tags inside folders (tags are folder-level).
- Migrating existing loose uploads into folders (can be done later via
  `POST /folders/:name/cids`).
- DB mirror/cache of the tree (add later only if listing latency demands it).
- DNSLink or human-readable stable URLs (IPNS keys are the stable names).
