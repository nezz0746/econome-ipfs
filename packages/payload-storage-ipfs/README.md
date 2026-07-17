# @leconome/payload-storage-ipfs

A [Payload CMS](https://payloadcms.com) **v3** storage adapter that routes
upload-collection files to **IPFS**. Each upload is pinned through an IPFS
Cluster–style ingest API, served from an IPFS gateway via its stored CID, and
unpinned when the document is deleted.

It targets the [Econome IPFS storage center](https://github.com/nezz0746/econome-ipfs)
ingest API, but works with **any** HTTP endpoint that implements the small
contract below.

## Install

```bash
pnpm add @leconome/payload-storage-ipfs @payloadcms/plugin-cloud-storage
```

`payload` and `@payloadcms/plugin-cloud-storage` are peer dependencies.

## Usage

```ts
import { buildConfig } from "payload";
import { ipfsStorage } from "@leconome/payload-storage-ipfs";

export default buildConfig({
  collections: [
    {
      slug: "media",
      upload: true,
      fields: [],
    },
  ],
  plugins: [
    ipfsStorage({
      apiUrl: process.env.IPFS_API_URL!, // https://api.example.com
      apiKey: process.env.IPFS_API_KEY!, // an ingest API key
      gatewayUrl: process.env.IPFS_GATEWAY_URL!, // https://ipfs.io
      collections: {
        media: true,
      },
    }),
  ],
});
```

That's it — uploads to the `media` collection are now pinned to IPFS. The
adapter adds a read-only **`cid`** field to each upload doc and serves files
from `‹gatewayUrl›/ipfs/‹cid›`.

### Options

| Option | Type | Description |
| --- | --- | --- |
| `apiUrl` | `string` | Base URL of the ingest API (no trailing slash). |
| `apiKey` | `string` | Sent as the `x-api-key` header on every request. |
| `gatewayUrl` | `string` | IPFS gateway used to build URLs and serve content. |
| `collections` | `Record<string, true \| CollectionOptions>` | Upload collections to route to IPFS. |
| `tags` | `string[]` | Optional replication tags applied to every upload. Tagged content is replicated only by the main node and cluster participants subscribed to one of the tags; omit for full replication. |
| `enabled` | `boolean` | Set `false` to disable (e.g. in local dev). |

## How it works

- **Upload** → `POST {apiUrl}/ingest` (multipart field `file`, plus a
  comma-separated `tags` field when configured, header `x-api-key`) → expects
  `{ "cid": "…" }`. The CID is stored on the doc.
- **URL** → `generateURL` returns `{gatewayUrl}/ipfs/{cid}`.
- **Serve** → `staticHandler` looks up the doc by filename and streams the
  bytes from the gateway (cached, immutable).
- **Delete** → `DELETE {apiUrl}/ingest/{cid}` (header `x-api-key`) to unpin.

### API contract (for other backends)

Any server implementing these two routes works:

- `POST /ingest` — multipart `file`, `x-api-key` header → `200 { "cid": string }`
- `DELETE /ingest/:cid` — `x-api-key` header → `200`

## Caveats

- **Shared CIDs**: identical content yields the same CID. Deleting one document
  unpins content that another document might still reference. Dedupe upstream if
  that matters.
- **Public content**: gateway URLs are public. Don't use this for private files
  unless your gateway enforces access control.

## License

MIT
