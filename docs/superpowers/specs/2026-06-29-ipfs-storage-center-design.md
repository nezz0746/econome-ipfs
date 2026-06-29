# IPFS Storage Center — Design

**Date:** 2026-06-29
**Status:** Approved (design), pending implementation plan
**Repo:** `econome-ipfs` (Turborepo, pnpm)

## 1. Purpose

Build a company-operated **private collaborative IPFS cluster** plus the software to run it:

- A **main IPFS node** (Kubo) wrapped by **IPFS Cluster** that stores and pins content.
- Outside **participants** who help secure storage by running a **follower** (Kubo + `ipfs-cluster-follow`) that replicates the company pinset.
- A **management dashboard** (Next.js) for monitoring peers/followers, cluster & node health, participant onboarding, and a small test upload.
- A **Hono API** for machine-facing, API-key-gated content ingest and as a typed gateway over the cluster REST API.
- Everything **deployable via Dockerfiles**, with a **docker-compose** stack for local development.

### Goals (v1)

- Operate a private collaborative cluster with a trusted main peer and untrusted followers.
- Auto-pin and replicate any content ingested through the main node.
- Onboard participants by generating a follower config bundle + one-line join command.
- Monitor peers/followers and cluster/node health from the dashboard.
- Multi-user authenticated dashboard (Better Auth).
- **Basic accounting:** persist per-participant contribution snapshots over time (bytes held, CIDs, last-seen) as the data foundation for future rewards.

### Non-goals (v1)

- No rewards/payout/billing logic (accounting data only).
- No public/open cluster membership — participants are vetted and onboarded.
- No browser-direct (Helia) uploads. Ingest goes through the API so it can be gated.
- No manual CID add/remove UI as a primary workflow — pinning is automatic on ingest.

## 2. Architecture

```
                    ┌────────────────────────────────────────┐
   machine clients  │  COMPANY (docker)                       │
   ──API key──▶ ┌───┴──┐   add+pin    ┌──────────────┐         │
                │ Hono │ ───────────▶ │ ipfs-cluster │◀─┐      │
   browser ▶ ┌──┤ API  │   REST 9094  │ (main peer)  │  │ CRDT │
   (session) │  └───┬──┘              └──────┬───────┘  │      │
        ┌─────┴──┐  │ internal token         │ proxy    │      │
        │  Next  │──┘  ┌──────────┐          ▼          │      │
        │  web   │─────│ Postgres │      ┌───────┐      │      │
        └────────┘     └──────────┘      │ Kubo  │      │      │
                                         └───────┘      │      │
                    └───────────────────────────────────┼──────┘
                                                         │ swarm/CRDT
   PARTICIPANTS:  Kubo + ipfs-cluster-follow  ───────────┘
```

**Cluster model:** Private collaborative cluster. The main `ipfs-cluster-service` peer is the only **trusted peer** (`trusted_peers`), uses a shared `CLUSTER_SECRET`, and CRDT consensus propagates its pinset to followers. Followers replicate read-only; they cannot mutate the shared pinset.

**BFF pattern:** The browser only talks to the Next app. The Next app talks to Hono server-side using a shared internal service token. The Hono API is the only thing that talks to the cluster REST API. Machine clients talk to Hono `/ingest` directly with an API key.

## 3. Monorepo layout

```
apps/
  web/                 # Next 16 dashboard (Better Auth, monitoring, onboarding, test upload)
  api/                 # Hono API (ingest, cluster gateway, accounting job)
packages/
  db/                  # NEW — Drizzle schema + client (shared by web & api)
  ui/                  # keep — shared React components
  eslint-config/       # keep
  typescript-config/   # keep
infra/
  cluster/             # ipfs-cluster service config / entrypoint
  kubo/                # kubo init config
docker-compose.yml     # local dev stack
docs/superpowers/specs/
```

**Removed:** `apps/docs`.

## 4. Components

### 4.1 `apps/api` — Hono API (Node 22)

Responsibilities:

- **`POST /ingest`** — API-key-gated. Streams multipart upload to cluster `POST /add` with replication factors from config. Returns `{ cid, size }`. Records `{ cid, size, apiKeyId, createdAt }` in Postgres.
- **Cluster gateway** — typed read endpoints the dashboard consumes (peers, pinset, pin status, health graph, metrics). Implemented via a `ClusterClient` wrapper over the cluster REST API.
- **Accounting job** — scheduled (interval) task that reads cluster peer metrics and writes per-peer contribution snapshots to Postgres.
- **Auth on gateway endpoints** — require the internal service token (calls come from the Next BFF, not the browser).

Key modules (each independently testable):

- `cluster-client.ts` — typed wrapper over cluster REST (`/add`, `/peers`, `/pins`, `/health/graph`, `/monitor/metrics`). No business logic.
- `ingest.ts` — ingest handler; depends on `cluster-client` + db. Cluster mocked in tests.
- `accounting.ts` — pure functions computing contribution snapshots from raw metrics + a job runner.
- `auth.ts` — API-key verification and internal-token middleware.

### 4.2 `apps/web` — Next 16 dashboard

- **Better Auth** mounted at `/api/auth/*`, Postgres-backed, email/password. Middleware gates dashboard routes.
- **BFF route handlers / server actions** proxy to Hono with the internal service token.
- **Pages:**
  - Overview: cluster health, peer count, total pinned, replication health.
  - Peers/Followers: list with health, free space, CIDs held, last-seen.
  - Onboarding: generate a follower bundle (cluster secret, bootstrap multiaddr, cluster name) + one-line `ipfs-cluster-follow` command; create/track an onboarding token (Postgres).
  - API keys: create/revoke machine ingest keys.
  - Test upload: small form that posts a file through the BFF → Hono `/ingest` (dev/testing aid).

### 4.3 `packages/db` — Drizzle + Postgres

Schema (initial):

- Better Auth tables (users, sessions, accounts, verification) — via Better Auth's Drizzle adapter.
- `api_keys` — `{ id, label, hashedKey, createdAt, revokedAt }`.
- `uploads` — `{ id, cid, size, apiKeyId, createdAt }`.
- `participants` — `{ id, peerId, label, onboardingTokenId, firstSeenAt, lastSeenAt }`.
- `onboarding_tokens` — `{ id, token, label, createdBy, usedByPeerId, createdAt, expiresAt }`.
- `contribution_snapshots` — `{ id, peerId, bytesHeld, cidCount, online, capturedAt }`.

Exports a configured Drizzle client + schema + migrations (`drizzle-kit`).

## 5. Infrastructure & deployment

### Local: `docker-compose.yml`

Services:

- `kubo` — main IPFS daemon (persisted volume).
- `cluster` — `ipfs-cluster-service`, trusted peer, `CLUSTER_SECRET`, points at `kubo`.
- `postgres` — db (persisted volume).
- `api` — Hono (built from `apps/api/Dockerfile`), env: cluster API URL, db URL, internal token.
- `web` — Next (built from `apps/web/Dockerfile`), env: Hono URL, internal token, auth secret, db URL.
- `follower` — sample participant: Kubo + `ipfs-cluster-follow` joined to `cluster`, to exercise add→pin→replicate locally.

### Deploy: Dockerfiles

- `apps/web/Dockerfile` — multi-stage, Next standalone output.
- `apps/api/Dockerfile` — multi-stage Node build.
- Cluster/Kubo use official images (`ipfs/kubo`, `ipfs/ipfs-cluster`) with mounted config from `infra/`.
- Per-app images work on any container host (e.g. Railway).

## 6. Data flow

1. **Ingest:** client → `POST /ingest` (API key) → Hono → cluster `POST /add?replication-min=..&replication-max=..` → CID returned; Hono writes `uploads` row.
2. **Replicate:** CRDT propagates the pin allocation; follower Kubo nodes fetch & pin.
3. **Monitor:** Hono polls cluster REST; Next BFF reads from Hono; dashboard renders.
4. **Accounting:** scheduled Hono job snapshots per-peer metrics into `contribution_snapshots`.

## 7. Auth model

- **Humans → dashboard:** Better Auth session cookies; Next middleware guards pages.
- **Next → Hono:** shared internal service token (env), required on gateway endpoints.
- **Machines → `/ingest`:** API keys (hashed in Postgres, managed in dashboard).
- **Cluster secret:** distributed only through onboarding bundles to vetted participants.

## 8. Testing strategy

TDD on logic-bearing units:

- `cluster-client` — request shaping / response parsing (HTTP mocked).
- `ingest` handler — API-key gating, streaming to cluster, db recording (cluster + db mocked or test db).
- `accounting` — pure snapshot computations from sample metrics.
- Auth guards — reject missing/invalid API key and internal token.

Integration: a docker-compose-based test that uploads a file via `/ingest`, asserts the CID pins on the main cluster, and replicates to the `follower` service.

## 9. Open questions / future work

- Rewards/payout logic on top of `contribution_snapshots` (separate spec).
- OAuth providers / roles in Better Auth if the admin team grows.
- Public collaborative cluster mode (empty secret + published template) if open membership is ever wanted.
- Alerting/notifications when peers drop or replication health degrades.
