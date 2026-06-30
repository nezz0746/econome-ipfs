# Econome — IPFS Storage Center

A company-operated **private collaborative IPFS cluster** plus the software to
run it. Your company runs the trusted cluster peer; vetted **participants** help
secure storage by running a follower (Kubo + `ipfs-cluster-follow`) that
replicates your pinset. Content ingested through the main node is automatically
pinned and replicated out to participants.

## Architecture

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

- **`apps/web`** — Next 16 dashboard. Better Auth (multi-user), peer/follower
  monitoring, cluster health, participant onboarding, API-key management, and a
  test upload. Talks to the API server-side (BFF) with an internal token.
- **`apps/api`** — Hono service. API-key-gated `/ingest` (→ cluster `/add`), a
  typed gateway over the cluster REST API, and a periodic accounting job that
  snapshots per-peer contribution into Postgres. Runs DB migrations on boot.
- **`packages/db`** — Drizzle schema + client + migrations, shared by both apps.
- **`packages/ui`**, **`packages/typescript-config`** — shared internals.
- **`infra/`** — Kubo init script and cluster notes.

## Local development

Prerequisites: Docker + Docker Compose, Node ≥ 22, pnpm 9.

Local dev only uses Docker for the **infrastructure** (Postgres, Kubo, IPFS
Cluster). The Next dashboard and Hono API run as plain dev servers — no image
builds. Everything has sensible localhost dev defaults, so **no `.env` file is
required**.

```bash
pnpm install
docker compose up -d --wait postgres kubo cluster   # infra only
pnpm dev                                             # web :3000 + api :8080
```

- Dashboard: http://localhost:3000 (create the first admin account on `/login`)
- API health: http://localhost:8080/health
- Cluster REST: http://localhost:9094

### VS Code tasks

`.vscode/tasks.json` wires this up so you don't have to remember commands
(`Cmd/Ctrl-Shift-B` runs the default **Dev** task):

| Task | What it does |
| --- | --- |
| **Dev** (default build) | Start infra (waits for health), then run web + api dev servers |
| **Infra: Up / Down / Logs** | Manage the Docker infra |
| **Follower: Up** | Start a sample participant follower |
| **DB: Migrate / Generate migration** | Drizzle migrations |
| **Stack: Full (Docker)** | Build + run the entire stack in containers |
| **Test / Lint** | `pnpm test` / `pnpm lint` |

The API applies DB migrations automatically on startup (with retry while
Postgres comes up).

### Other scripts

```bash
pnpm test           # vitest across packages
pnpm check-types    # tsc across the workspace
pnpm lint           # biome
pnpm db:generate    # generate a new migration after editing the schema
```

### Emulating a participant follower

```bash
# After infra is up, copy the main cluster peer ID from its logs and set
# CLUSTER_MAIN_PEER_MULTIADDR in .env, then:
docker compose --profile follower up -d
```

This runs a second peer so you can watch the add → pin → replicate flow end to
end on the Peers page.

### Full containerized stack

To run the apps in Docker too (closer to production):

```bash
docker compose --profile apps up --build
```

## Deployment

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for a full Dokploy walkthrough
(`docker-compose.prod.yml`, env vars, domains, participant onboarding).

Each app also ships as its own image, so you can deploy on any container host:

```bash
docker build -f apps/api/Dockerfile -t econome-api .
docker build -f apps/web/Dockerfile -t econome-web .
```

The API image runs the TypeScript entrypoint via `tsx` and applies migrations on
start (set `RUN_MIGRATIONS=false` to skip). The web image uses Next's standalone
output. Provide the same env vars as `.env.example`. Kubo and IPFS Cluster use
the official `ipfs/kubo` and `ipfs/ipfs-cluster` images.

## Payload CMS integration

[`@leconome/payload-storage-ipfs`](packages/payload-storage-ipfs) is a publishable
Payload CMS v3 storage adapter: point your CMS's upload collections at this
storage center and every asset is pinned to IPFS (via the ingest API), served
from your gateway, and unpinned on delete. See its
[README](packages/payload-storage-ipfs/README.md). Releases are managed with
changesets (`pnpm changeset`).

## Tooling

- **Turborepo** for task orchestration, **pnpm** workspaces.
- **Biome** for lint + format (`pnpm lint`, `pnpm format`).
- **Drizzle** migrations in `packages/db/drizzle`.

See `docs/superpowers/specs/` and `docs/superpowers/plans/` for the design and
implementation plan.
