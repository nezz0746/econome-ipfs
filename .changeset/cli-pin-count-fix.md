---
"@leconome/cli": patch
---

Fix `econome status` reporting an inflated "Tracked pins" count. It counted
every line of `ipfs-cluster-ctl status`, but that plain-text output prints a
header line per CID plus one line per peer, so the count was multiplied by the
peer count (e.g. 111 instead of 37). It now reads `--enc=json status` and
counts one entry per CID, matching the dashboard.
