# @leconome/cli

## 0.4.1

### Patch Changes

- ef9e13b: Fix `--save-key`: the key was written to `publish.json` but read back from
  `config.json`, so a saved key was silently ignored and every run still demanded
  `ECONOME_API_KEY`.

  Credentials now live in their own 0600 file, deliberately not in the follower
  config, which `join` rewrites wholesale and would clobber.

## 0.4.0

### Minor Changes

- 884c741: Add `econome publish <dir>`: upload a directory to a mutable IPFS folder and
  print the resulting CID, gateway URL and IPNS address.

  Uploads are batched, and only the final batch commits, so a half-uploaded site
  is never published and the IPNS name is republished once rather than per batch.

  Includes a `--dry-run` that needs no credentials, and two pre-flight checks: a
  missing root `index.html`, and root-absolute asset paths that 404 when served
  from `/ipfs/<cid>/`.

## 0.3.0

### Minor Changes

- 20aeef8: Tag-based partial replication support.

  - `@leconome/payload-storage-ipfs`: new optional `tags` option — replication
    tags applied to every upload (sent as a comma-separated `tags` field on
    `/ingest`). Tagged content is replicated only by the main node and cluster
    participants subscribed to one of the tags; omitting the option keeps full
    replication. Backward compatible.
  - `@leconome/cli`: `econome join --tags a,b` subscribes the follower to
    replication tags at registration; omit to use the defaults set on the
    onboarding token.

## 0.2.2

### Patch Changes

- 7f9502a: Fix `econome status` reporting "Tracked pins: 0" when the follower actually has
  pins. `ipfs-cluster-ctl --enc=json status` does not emit a JSON array — it
  prints one pretty-printed object per CID, concatenated — so parsing the whole
  blob as a single JSON value threw and the count fell back to 0. Count top-level
  JSON objects instead (robust to a single array, newline-delimited objects, or
  concatenated pretty-printed objects).

## 0.2.1

### Patch Changes

- 7478e6f: Fix `econome status` reporting an inflated "Tracked pins" count. It counted
  every line of `ipfs-cluster-ctl status`, but that plain-text output prints a
  header line per CID plus one line per peer, so the count was multiplied by the
  peer count (e.g. 111 instead of 37). It now reads `--enc=json status` and
  counts one entry per CID, matching the dashboard.

## 0.2.0

### Minor Changes

- b051911: Initial release. `npx @leconome/cli join <url>` stands up a Dockerized Kubo +
  ipfs-cluster follower from a dashboard onboarding link, registers the peer with
  the dashboard, and manages it via `status`, `logs`, `stop`, and `update`.
