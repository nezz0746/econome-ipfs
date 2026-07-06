---
"@leconome/cli": patch
---

Fix `econome status` reporting "Tracked pins: 0" when the follower actually has
pins. `ipfs-cluster-ctl --enc=json status` does not emit a JSON array — it
prints one pretty-printed object per CID, concatenated — so parsing the whole
blob as a single JSON value threw and the count fell back to 0. Count top-level
JSON objects instead (robust to a single array, newline-delimited objects, or
concatenated pretty-printed objects).
