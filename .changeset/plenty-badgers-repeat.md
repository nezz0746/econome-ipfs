---
"@leconome/payload-storage-ipfs": patch
---

Add `homepage` and `author` metadata, and an attribution footer in the README.

The npm page previously rendered no link back to the studio. Package metadata
and README are read from the published tarball, so this only reaches npmjs.com
on release.
