# @leconome/cli

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
