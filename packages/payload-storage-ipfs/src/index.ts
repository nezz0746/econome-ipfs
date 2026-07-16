import { cloudStoragePlugin } from "@payloadcms/plugin-cloud-storage";
import type {
  Adapter,
  CollectionOptions,
} from "@payloadcms/plugin-cloud-storage/types";
import type { Config, Plugin } from "payload";

export interface IpfsStorageOptions {
  /** Base URL of the storage-center API (the Hono service), e.g. https://api.example.com */
  apiUrl: string;
  /** Ingest API key, sent as the `x-api-key` header. */
  apiKey: string;
  /** Public IPFS gateway used to serve content, e.g. https://ipfs.io */
  gatewayUrl: string;
  /**
   * Replication tags applied to every upload. Tagged content is replicated
   * only by the main node and participants subscribed to one of the tags;
   * omit for full replication.
   */
  tags?: string[];
  /**
   * Upload collections to route to IPFS. `true` enables defaults; an object
   * lets you tweak per-collection options.
   */
  collections: Record<
    string,
    true | Partial<Omit<CollectionOptions, "adapter">>
  >;
  /** Set to false to disable the plugin (e.g. during local development). */
  enabled?: boolean;
}

interface IngestResponse {
  cid?: string;
}

function getCid(value: unknown): string | undefined {
  if (value && typeof value === "object" && "cid" in value) {
    const cid = (value as { cid?: unknown }).cid;
    return typeof cid === "string" ? cid : undefined;
  }
  return undefined;
}

/** Build the cloud-storage adapter that talks to the IPFS ingest API. */
function ipfsAdapter(options: IpfsStorageOptions): Adapter {
  const base = options.apiUrl.replace(/\/$/, "");
  const gateway = options.gatewayUrl.replace(/\/$/, "");
  const authHeader = { "x-api-key": options.apiKey };

  return () => ({
    name: "ipfs",
    // Persist the CID alongside each file so URLs/serving can resolve it.
    fields: [
      {
        name: "cid",
        type: "text",
        label: "IPFS CID",
        admin: { readOnly: true, description: "Content identifier on IPFS." },
      },
    ],

    async handleUpload({ data, file }) {
      const form = new FormData();
      form.append(
        "file",
        new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }),
        file.filename,
      );
      if (options.tags && options.tags.length > 0) {
        form.append("tags", options.tags.join(","));
      }
      const res = await fetch(`${base}/ingest`, {
        method: "POST",
        headers: authHeader,
        body: form,
      });
      if (!res.ok) {
        throw new Error(
          `IPFS ingest failed: ${res.status} ${await res.text()}`,
        );
      }
      const json = (await res.json()) as IngestResponse;
      if (!json.cid) throw new Error("IPFS ingest returned no CID");
      (data as Record<string, unknown>).cid = json.cid;
    },

    async handleDelete({ doc }) {
      const cid = getCid(doc);
      if (!cid) return;
      // Note: if multiple docs share a CID, this unpins content still
      // referenced elsewhere. Dedupe upstream if that matters to you.
      await fetch(`${base}/ingest/${cid}`, {
        method: "DELETE",
        headers: authHeader,
      });
    },

    generateURL({ data }) {
      const cid = getCid(data);
      return cid ? `${gateway}/ipfs/${cid}` : "";
    },

    async staticHandler(req, { params }) {
      const result = await req.payload.find({
        collection: params.collection,
        where: { filename: { equals: params.filename } },
        depth: 0,
        limit: 1,
        req,
      });
      const cid = getCid(result.docs[0]);
      if (!cid) return new Response("Not Found", { status: 404 });

      const upstream = await fetch(`${gateway}/ipfs/${cid}`);
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          "Content-Type":
            upstream.headers.get("content-type") ?? "application/octet-stream",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    },
  });
}

/**
 * Payload v3 plugin that stores upload-collection files on IPFS: each upload is
 * pinned through the storage-center ingest API, served from an IPFS gateway,
 * and unpinned when the document is deleted.
 *
 * @example
 * ```ts
 * import { ipfsStorage } from "@leconome/payload-storage-ipfs";
 *
 * export default buildConfig({
 *   plugins: [
 *     ipfsStorage({
 *       apiUrl: process.env.IPFS_API_URL!,
 *       apiKey: process.env.IPFS_API_KEY!,
 *       gatewayUrl: process.env.IPFS_GATEWAY_URL!,
 *       collections: { media: true },
 *     }),
 *   ],
 * })
 * ```
 */
export function ipfsStorage(options: IpfsStorageOptions): Plugin {
  return (incomingConfig: Config): Config => {
    if (options.enabled === false) return incomingConfig;

    const adapter = ipfsAdapter(options);
    const collections: Record<string, CollectionOptions> = {};
    for (const [slug, value] of Object.entries(options.collections)) {
      collections[slug] = {
        adapter,
        disablePayloadAccessControl: true,
        ...(typeof value === "object" ? value : {}),
      };
    }

    return cloudStoragePlugin({ collections })(incomingConfig);
  };
}

export default ipfsStorage;
