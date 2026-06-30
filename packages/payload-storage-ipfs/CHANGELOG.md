# @leconome/payload-storage-ipfs

## 0.2.0

### Minor Changes

- 4b97424: Initial release. A Payload CMS v3 storage adapter that routes upload-collection
  files to IPFS: each upload is pinned through an IPFS Cluster ingest API, served
  from an IPFS gateway via a stored CID, and unpinned when the document is deleted.
