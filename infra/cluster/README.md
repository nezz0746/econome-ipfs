# IPFS Cluster (main peer)

The main peer is the official `ipfs/ipfs-cluster` image configured entirely via
environment variables in `docker-compose.yml` — no `service.json` is committed,
so the same image works across environments.

Key settings (see compose):

- `CLUSTER_SECRET` — 32-byte hex shared network secret. Generate with
  `openssl rand -hex 32`. Distribute only to vetted participants via the
  dashboard onboarding bundle.
- `CLUSTER_IPFSHTTP_NODEMULTIADDRESS` — points the peer at the Kubo daemon
  (`/dns4/kubo/tcp/5001`).
- `CLUSTER_RESTAPI_HTTPLISTENMULTIADDRESS` — REST API bind
  (`/ip4/0.0.0.0/tcp/9094`); only the Hono API talks to it.
- `CLUSTER_CRDT_TRUSTEDPEERS` — set to `*` for local dev. In production, set it
  to the main peer ID(s) so only your peers can modify the shared pinset; the
  collaborative followers replicate read-only.

## Participants (followers)

Production participants do **not** run a full peer. They run Kubo plus
`ipfs-cluster-follow`, joining with the bundle generated on the dashboard's
Onboarding page:

```
CLUSTER_SECRET=<secret> ipfs-cluster-follow econome run --init <bootstrap-multiaddr>
```

The `follower-*` services in `docker-compose.yml` (profile `follower`) emulate a
participant locally using a second peer so the add → pin → replicate flow is
testable end to end.
