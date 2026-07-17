---
"@leconome/payload-storage-ipfs": patch
---

Fix uploads persisting an empty `cid` (and therefore an empty file URL) on
`@payloadcms/plugin-cloud-storage` >= 3.85.

That version runs `handleUpload` inside an `afterChange` hook on the
already-saved document and persists only the metadata **returned** from
`handleUpload` (via a follow-up `payload.update`), so mutating `data.cid` in
place was a no-op and the CID never landed. `handleUpload` now also returns
`{ cid }`. Still backward compatible with older plugin versions that read the
mutated `data`.
