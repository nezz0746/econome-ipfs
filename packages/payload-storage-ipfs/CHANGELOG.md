# @leconome/payload-storage-ipfs

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

## 0.2.0

### Minor Changes

- 4b97424: Initial release. A Payload CMS v3 storage adapter that routes upload-collection
  files to IPFS: each upload is pinned through an IPFS Cluster ingest API, served
  from an IPFS gateway via a stored CID, and unpinned when the document is deleted.
