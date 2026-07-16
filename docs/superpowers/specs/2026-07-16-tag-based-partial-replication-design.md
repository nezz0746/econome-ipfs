# Tag-based partial replication (per-pin allocations)

**Date:** 2026-07-16
**Status:** Approved direction (option 2 from prior discussion): explicit per-pin
`user-allocations` on the IPFS Cluster pin, driven by app-level tags.

## Goal

Let participants replicate only a share of the pinset. Content can be tagged at
ingest; participants subscribe to tags. A tagged pin is allocated only to the
main peer plus the subscribed participants' cluster peers. Untagged content
keeps today's behaviour (replication factor -1, pinned by every peer).

## Semantics

- A **tag** is a lowercase slug matching `[a-z0-9][a-z0-9-]{0,31}`. Inputs are
  comma-separated and normalized (trim, lowercase, dedupe).
- **Untagged pin** → pinned with the env replication factor (default -1,
  everywhere). Unchanged.
- **Tagged pin** → pinned with:
  - `user-allocations` = main cluster peer + every participant subscribed to at
    least one of the pin's tags,
  - `replication-min=1`, `replication-max=len(allocations)`,
  - `meta-tags=<a,b>` — the pin itself carries its tags in cluster metadata, so
    reconciliation works for every ingest path (upload, pin-by-CID, CAR import)
    without depending on an uploads row.
- Every participant always replicates the untagged base pinset (rf -1 forces
  this); tag subscriptions opt them **into** tagged collections on top.
- Followers honor allocations natively: a follower pins a CID only when its
  peer ID is in the pin's allocation list (or rf is -1). No follower-side
  changes are needed.

### Known cluster-mechanics caveat

The cluster allocator treats `user-allocations` as a priority list. If a
subscribed peer is offline at pin time it cannot be allocated, and another peer
may be substituted to reach `replication-max`. The reconciliation job (below)
converges allocations back to the desired set once peers are online. Tags are a
capacity/opt-in mechanism, not a confidentiality boundary.

## Data model (packages/db)

- `uploads.tags text[] NOT NULL DEFAULT '{}'` — display on the Files page.
- `participants.subscribed_tags text[] NOT NULL DEFAULT '{}'` — the peer's
  subscriptions; editable from the dashboard.
- `onboarding_tokens.tags text[] NOT NULL DEFAULT '{}'` — default subscriptions
  applied when a participant joins with that token (CLI `--tags` overrides).

## API (apps/api)

- `ClusterClient`: new `id()` (GET /id, memoized by the caller); `add()` and
  `pinByCid()` accept `userAllocations: string[]` and `metadata:
  Record<string,string>`; `pins()` parses the `metadata` field.
- New `tags.ts` module (pure, unit-tested):
  - `parseTags(input: unknown): string[] | null` — normalize/validate.
  - `desiredAllocations(tags, mainPeerId, participants)` — main + subscribers.
  - `planReallocations(pins, participants, mainPeerId, onlinePeerIds)` —
    returns re-pin actions. A pin is re-pinned iff:
    1. a subscribed peer is **online but missing** from the pin's allocations, or
    2. the allocations contain **extra peers** (unsubscribed/substitutes) and
       every desired peer is online (so the re-pin can actually shed them).
    This converges without churning while subscribers are offline.
- `/ingest` accepts an optional `tags` multipart field; `/ingest/pin` and
  `/ingest/import` accept an optional `tags: string[]` body field applied to
  the batch. Tagged requests resolve allocations from the DB at pin time and
  record `tags` on the uploads row. Invalid tags → 400.
- Reconciliation runs on the existing accounting interval: fetch pins (with
  metadata), peers, and participants; apply `planReallocations`; re-POST
  `/pins/{cid}` with the new `user-allocations` (preserving name + meta).

## Join flow

- CLI: `econome join [url] --tags photos,videos`; without the flag, an optional
  interactive prompt (empty = operator defaults from the token). Tags are sent
  with the peer registration.
- Web register route (`/join/[token]/register`): accepts optional `tags`;
  **upserts the participants row** (peerId, label from the token, subscriptions
  = CLI tags ?? token tags) in addition to marking the token used. This also
  fixes participants only appearing after the first accounting tick.

## Web UI

- **Files**: Tags column (badges) from `uploads.tags`.
- **Test Upload**: optional tags input, forwarded through the ingest call.
- **Onboarding**: optional tags on the mint-token form; tags shown in the
  tokens table.
- **Peers**: Tags column showing each participant's subscriptions.
- **Peer detail**: subscribed tags + inline edit form (server action). Changes
  converge via the reconciliation job within one accounting interval.
- `EnrichedPeer` (api peer-view + web types) gains `subscribedTags`.

## Out of scope

- `payload-storage-ipfs` tag pass-through (follow-up; trivial once /ingest
  accepts tags).
- Tag-driven deletion/garbage collection; DAG sharding; per-tag quotas.
- A tag registry table — tags are free-form slugs; the set in use is derivable.

## Testing

- `tags.test.ts`: parsing, desired allocations, reallocation planning matrix
  (offline subscriber, unsubscribe shed, substitute shed, no-op cases).
- `cluster-client.test.ts`: user-allocations/meta params on add + pin; metadata
  parsing on pins().
- `app.test.ts`: tagged ingest calls cluster with allocations + meta and
  records tags; invalid tags rejected.
- CLI `register.test.ts`: tags included in the registration payload.
