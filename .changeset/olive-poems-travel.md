---
"@leconome/cli": minor
---

Add `econome publish <dir>`: upload a directory to a mutable IPFS folder and
print the resulting CID, gateway URL and IPNS address.

Uploads are batched, and only the final batch commits, so a half-uploaded site
is never published and the IPNS name is republished once rather than per batch.

Includes a `--dry-run` that needs no credentials, and two pre-flight checks: a
missing root `index.html`, and root-absolute asset paths that 404 when served
from `/ipfs/<cid>/`.
