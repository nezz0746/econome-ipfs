# Gateway Request Analytics

**Date:** 2026-07-21
**Status:** Designed — NOT implemented. Pick this up when ready; no code exists yet.

## Goal

Internal visibility into how the public IPFS gateway is used: total requests,
requests per CID, bytes served, and a breakdown per replication tag — charted
in the dashboard.

## Decisions (locked during design)

| Question | Decision |
|---|---|
| Traffic in scope | **Public HTTP gateway only** (`ipfs-gateway.econome.studio`, i.e. `/ipfs/<cid>` and `/ipns/<key>`). Not the machine API, not P2P/bitswap. |
| Why not bitswap | Kubo exposes no reliable per-CID attribution for blocks served to peers — aggregate counters at best. Big effort, weak data. |
| Granularity | **Rollups + short raw window**: raw request rows kept ~30 days for drill-down; permanent hourly rollups per CID drive the charts. |
| Dimensions | **Essentials only**: timestamp, CID, path, response bytes, status. No IP, no user-agent, no referrer — nothing personal to justify or retain. |
| Capture mechanism | **Traefik access logs** (option B), not proxying the gateway through the API. Keeps Kubo serving content directly so analytics can never slow down or take down the gateway. |
| Tag resolution | **Joined at read time** against the cluster pinset, not snapshotted per row. |
| Surfaces | A new **Analytics** page + **overview tiles**. |

### Rejected alternatives

- **Proxy the gateway through the Hono API** — much simpler to build and test,
  but puts Node in the content-serving data path: all gateway bandwidth flows
  through it and an API redeploy/crash becomes a gateway outage.
- **Umami** (already deployed for other projects) — it is a JS-tracker page
  analytics tool. Gateway fetches execute no JavaScript, so it cannot observe
  them at all.
- **Prometheus + Grafana** — Traefik and Kubo expose only aggregate,
  router-level metrics. Per-CID would be a high-cardinality anti-pattern, and
  per-tag is impossible (no access to pin metadata).

## Architecture

Traefik (already fronts every service) writes JSON access logs → the API
container mounts that file read-only → a periodic ingest job tails new lines →
filters to the gateway host → parses CID + bytes → writes raw rows + hourly
rollups to Postgres → the dashboard charts the rollups.

### 1. Traefik configuration (one-time infra change)

Current state (verified 2026-07-21 via the Dokploy API): the static config has
**no `accessLog` section** — access logs are off. The file provider watches
`/etc/dokploy/traefik/dynamic`.

Add to the Traefik static config:

```yaml
accessLog:
  filePath: /etc/dokploy/traefik/access.log   # NOT under dynamic/ — that dir is parsed as config
  format: json
  bufferingSize: 100
  fields:
    defaultMode: keep
    headers:
      defaultMode: drop      # no cookies, auth headers or user-agents ever written
```

Useful fields in the JSON output: `time`, `RequestHost`, `RequestPath`,
`RequestMethod`, `DownstreamStatus`, `DownstreamContentSize`, `RouterName`,
`ServiceName`.

**This is global to the Dokploy host** — every app on that Traefik logs, not
just this project. That is the accepted cost of not touching the hot path.

**Rotation:** Traefik does not rotate its own access log. Plan: a small
`logrotate` sidecar in the econome compose rotating daily with `copytruncate`,
keeping 3 generations. Alternative if that feels too invasive (it rotates a
file shared with other projects): configure host-level logrotate once,
outside this repo. Either way the collector must tolerate truncation.

### 2. Postgres (`packages/db`)

- **`gateway_requests`** — raw rows: `ts timestamptz`, `cid text`,
  `path text`, `status smallint`, `bytes bigint`. Indexed on `ts` and `cid`.
  Retention ~30 days.
- **`gateway_hourly`** — permanent rollup, PK `(bucket, cid)`, columns
  `requests int`, `bytes bigint`. Charts read only this, so they stay fast as
  history grows.
- **`gateway_ingest_state`** — singleton row holding the last read byte offset.

### 3. Ingest job (`apps/api`)

New module (parser + aggregator kept pure and unit-testable, separate from the
file/DB I/O). Runs on the **existing accounting interval** (60s in prod),
alongside the accounting / reallocation / folder-reconcile jobs.

Per tick:
1. Read the saved offset. **If file size < offset, reset to 0** — the file was
   rotated or truncated.
2. Stream lines from the offset; parse each as JSON.
3. Keep only `RequestHost == <gateway host>` **and** a path starting with
   `/ipfs/` or `/ipns/`.
4. Extract the root CID (first path segment after the prefix); ignore any
   deeper subpath and query string for keying, but keep the full path on the
   raw row.
5. Accumulate in memory per `(hour bucket, cid)`.
6. **Insert raw rows, upsert rollups, and advance the offset in ONE
   transaction.** This is load-bearing: rollup upserts are additive, so a
   mid-batch failure with a separately-committed offset would replay and
   double-count.

Config: `TRAEFIK_ACCESS_LOG_PATH` (default `/var/log/traefik/access.log` inside
the container), `GATEWAY_HOST` (e.g. `ipfs-gateway.econome.studio`).

Failure modes: missing log file (dev, or logs not yet enabled) → clean no-op,
logged once. Malformed lines → counted and skipped, never fatal.

### 4. Retention job

Delete `gateway_requests` rows older than the retention window (default 30
days) on the same tick — a cheap indexed DELETE. Rollups are never deleted.

### 5. Tag resolution (read time)

Rollups key on CID only. The analytics query joins CIDs against the **cluster
pinset** (via the existing 15s-cached cluster client), which is the
authoritative home of both tags and pin names. CIDs absent from the pinset are
labelled **passthrough** — content the gateway fetched from the network but
does not pin.

Rationale: tags live in exactly one place (cluster pin metadata), and
re-tagging a folder never requires rewriting history. **Tradeoff, accepted:**
historical charts reflect *current* tags, not the tags in force at request
time. If point-in-time tag accuracy is ever needed, snapshot tags onto the
rollup row instead.

Note that a gateway request for `/ipfs/<folderRoot>/some/file` carries the
folder's root CID, so folder requests attribute to the folder's tags
naturally.

### 6. Dashboard (`apps/web`)

- **New Analytics page** (sidebar entry): time-range selector (24h / 7d / 30d),
  requests + bytes over time, top CIDs (with pin name and tags), per-tag
  breakdown, ours-vs-passthrough split.
- **Overview tiles**: requests and bytes served in the last 24h / 7d.
- Reuses the existing shadcn/recharts setup.

## Testing

Unit tests, with a fake filesystem and store — no live Traefik needed:
- Parser: malformed lines skipped; non-gateway hosts filtered out; `/ipfs` vs
  `/ipns`; subpaths and query strings; CID extraction.
- Aggregator: correct hour bucketing, request/byte sums.
- Offset logic: `size < offset` resets to 0; offset advances only with a
  successful transaction.

## Open items for implementation time

- Confirm the exact Traefik JSON field names against the deployed Traefik
  version before writing the parser.
- Decide logrotate sidecar vs host-level rotation.
- Pick the retention window (30 days assumed) and rollup granularity (hourly
  assumed; daily is cheaper if 30-day charts are the common case).
