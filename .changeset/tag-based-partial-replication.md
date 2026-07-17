---
"@leconome/payload-storage-ipfs": minor
"@leconome/cli": minor
---

Tag-based partial replication support.

- `@leconome/payload-storage-ipfs`: new optional `tags` option — replication
  tags applied to every upload (sent as a comma-separated `tags` field on
  `/ingest`). Tagged content is replicated only by the main node and cluster
  participants subscribed to one of the tags; omitting the option keeps full
  replication. Backward compatible.
- `@leconome/cli`: `econome join --tags a,b` subscribes the follower to
  replication tags at registration; omit to use the defaults set on the
  onboarding token.
