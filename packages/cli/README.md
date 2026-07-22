# @leconome/cli

One command to join the Econome IPFS cluster as a follower.

```bash
npx -y @leconome/cli join <join-url-from-dashboard>
```

Requires Docker. Manage the follower with:

```bash
econome status   # is it running / replicating, pin count
econome logs -f  # tail follower logs
econome stop     # stop (keeps data)
econome update   # pull newer images and restart
```

The join URL comes from the dashboard's **Onboarding** page (one per minted
token). The CLI fetches the cluster config, starts a Kubo + ipfs-cluster
follower under `~/.econome`, and registers the new peer with the dashboard.

## Publishing a site

Publish a directory to IPFS and get a URL back:

```bash
export ECONOME_API_KEY=…            # or: econome publish --save-key
econome publish ./dist --name mon-site
```

The directory is uploaded into a mutable folder. Every publish returns a CID
pinning that exact version, and, once the folder has an IPNS key, a stable
address that follows subsequent publishes.

```
econome publish ./dist --dry-run    # list what would go, upload nothing
econome publish ./dist --yes        # skip the confirmation
econome publish ./dist --tags web   # replication tags
```

`--dry-run` needs no credentials: checking what you are about to publish is the
first thing you want to do.

### Before you publish

Two checks run automatically, because they catch the mistakes that actually
happen:

- **No `index.html` at the root.** A gateway will render a file listing rather
  than a site, usually because the project root was published instead of the
  build output.
- **Root-absolute asset paths.** Served from `/ipfs/<cid>/`, `href="/app.css"`
  resolves to the gateway root and 404s. Build with relative paths, or serve
  the folder from a domain root through its IPNS name.

`.git`, `node_modules`, `.env` and OS noise are never uploaded.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ECONOME_API_KEY` | — | Required to publish |
| `ECONOME_API_URL` | `https://ipfs-api.econome.studio` | API origin |
| `ECONOME_GATEWAY_URL` | `https://ipfs-gateway.econome.studio` | Used for printed URLs |

The environment wins over the stored config on purpose, so a run against
another cluster never depends on what happens to be in `~/.econome`. The API
key is not accepted as a flag: it would end up in shell history and CI logs.

**Published content is public and cannot be reliably unpublished.** Anything
already fetched or pinned elsewhere survives an unpin.

## Built by

Made by [L'Économe](https://econome.studio), a web and software studio in
Toulouse building on open technologies and self-hosted infrastructure.

We wrote an introduction to content addressing, which is what this cluster
stores things with: [Qu'est-ce qu'IPFS ?](https://econome.studio/blog/qu-est-ce-que-ipfs)
