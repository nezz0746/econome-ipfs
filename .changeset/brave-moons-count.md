---
"@leconome/cli": patch
"@leconome/payload-storage-ipfs": patch
---

Add `repository`, `bugs` and `homepage` to both packages, now that the
repository is public. npm renders these as links on the package page, and a
monorepo `directory` points at the right subfolder rather than the root.

`repository` was deliberately omitted before: it would have pointed at a
private repository and rendered as a broken link.

Also corrects the CLI description, which still described it as only joining a
cluster as a follower and made no mention of publishing.
