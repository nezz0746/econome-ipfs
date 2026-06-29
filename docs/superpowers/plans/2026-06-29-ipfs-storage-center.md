# IPFS Storage Center Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Implements `docs/superpowers/specs/2026-06-29-ipfs-storage-center-design.md`.

**Goal:** Stand up a company-operated private collaborative IPFS cluster with a Hono ingest/gateway API, a Next 16 management dashboard (Better Auth), shared Drizzle/Postgres data layer, participant onboarding, basic contribution accounting, and Docker-based local + deployable infra.

**Architecture:** Kubo + ipfs-cluster main peer; participants run Kubo + ipfs-cluster-follow as untrusted followers. Hono API is the only service that talks to the cluster REST API (ingest + typed gateway + accounting job). Next app is a BFF — browser → Next (Better Auth session) → Hono (internal service token). Postgres via Drizzle, shared in `packages/db`.

**Tech Stack:** Turborepo + pnpm, Next 16 / React 19, Hono on Node 22, Drizzle ORM + Postgres, Better Auth, IPFS Kubo + IPFS Cluster, Docker / docker-compose, Vitest for tests.

## Global Constraints

- **No commits.** Leave all work as **unstaged changes on `main`**. Wherever a task says "verify"/"done", do NOT `git add`/`git commit`.
- Node `>=22`. pnpm `9.x`. Keep `packageManager` pinned.
- Next stays at `16.x` (already latest); React `19.x`.
- Keep `packages/ui`, `packages/eslint-config`, `packages/typescript-config`. Remove `apps/docs`.
- All secrets via env. Cluster secret distributed only through onboarding bundles.
- Ingest is API-key gated; cluster REST API is never exposed to the browser.
- Tests with Vitest. TDD on logic units (cluster-client, ingest, accounting, auth guards).

---

## Phase 0 — Repo cleanup & scaffolding

### Task 0.1: Remove docs app, prep workspace
**Files:** Delete `apps/docs/`. Modify root `package.json` scripts if they reference docs (they don't). Modify `pnpm-workspace.yaml` (no change needed; globs cover new apps/packages).

- [ ] Delete `apps/docs/`.
- [ ] Add `dotenv`/env handling expectations to `.gitignore`: ensure `.env`, `*.env`, `node_modules`, `.next`, `dist`, `ipfs-data/`, `cluster-data/`, `pg-data/` are ignored.
- [ ] Run `pnpm install` and `pnpm -w build` to confirm the workspace is still healthy after docs removal (web should build).
- [ ] Verify: `pnpm --filter web build` succeeds; `apps/docs` gone.

---

## Phase 1 — Shared data layer (`packages/db`)

### Task 1.1: Create `packages/db` with Drizzle + Postgres
**Files:**
- Create `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/drizzle.config.ts`
- Create `packages/db/src/schema.ts`, `packages/db/src/client.ts`, `packages/db/src/index.ts`

**Interfaces — Produces:**
- `import { db } from "@repo/db"` — configured Drizzle client (reads `DATABASE_URL`).
- `import * as schema from "@repo/db/schema"` — tables: `apiKeys`, `uploads`, `participants`, `onboardingTokens`, `contributionSnapshots`, plus Better Auth tables (`user`, `session`, `account`, `verification`).
- `migrate()` helper or `drizzle-kit` migrations under `packages/db/drizzle/`.

- [ ] Add deps: `drizzle-orm`, `postgres` (or `pg`), dev `drizzle-kit`, `vitest`.
- [ ] Write `schema.ts` with the tables from spec §4.3 (exact columns). Better Auth tables follow Better Auth's required shape.
- [ ] Write `client.ts` exporting `db` built from `DATABASE_URL`.
- [ ] Add `db:generate` and `db:migrate` scripts.
- [ ] Verify: `pnpm --filter @repo/db db:generate` emits SQL migration; `tsc --noEmit` passes.

---

## Phase 2 — Hono API (`apps/api`)

### Task 2.1: Scaffold Hono app + health endpoint
**Files:** Create `apps/api/package.json`, `tsconfig.json`, `src/index.ts`, `src/app.ts`, `vitest.config.ts`, `test/health.test.ts`.

**Interfaces — Produces:** `createApp(): Hono` factory; `GET /health` → `{ ok: true }`.

- [ ] **Step 1 (test):** `test/health.test.ts` — `app.request('/health')` returns 200 `{ ok: true }`.
- [ ] **Step 2:** Run vitest → fails (no app).
- [ ] **Step 3:** Implement `createApp()` with `/health`.
- [ ] **Step 4:** Run vitest → passes.
- [ ] Add `@hono/node-server` entry in `src/index.ts` (port from `PORT`).

### Task 2.2: `ClusterClient` wrapper (TDD)
**Files:** Create `apps/api/src/cluster-client.ts`, `test/cluster-client.test.ts`.

**Interfaces — Produces:**
- `class ClusterClient(baseUrl: string)` with:
  - `add(stream, opts): Promise<{ cid: string; size: number }>`
  - `peers(): Promise<ClusterPeer[]>`
  - `pins(): Promise<PinInfo[]>`
  - `healthGraph(): Promise<HealthGraph>`
  - `metrics(name: string): Promise<Metric[]>`
- Types `ClusterPeer`, `PinInfo`, `HealthGraph`, `Metric`.

- [ ] **Step 1 (test):** mock `fetch`; assert `peers()` calls `GET {base}/peers` and parses the ndjson/json array into `ClusterPeer[]`.
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3:** Implement minimal `ClusterClient` (request shaping + parsing only, no business logic).
- [ ] **Step 4:** Run → pass.
- [ ] Repeat test→impl for `add` (multipart, returns cid) and `metrics`.

### Task 2.3: Auth middleware (TDD)
**Files:** Create `apps/api/src/auth.ts`, `test/auth.test.ts`.

**Interfaces — Produces:**
- `apiKeyAuth(db)` middleware — reads `Authorization: Bearer <key>` / `x-api-key`, hashes, looks up non-revoked `apiKeys`, sets `c.set('apiKeyId', id)`; 401 otherwise.
- `internalAuth(token)` middleware — requires `x-internal-token` === env token; 401 otherwise.
- `hashApiKey(raw): string`.

- [ ] **Step 1 (test):** request with no key → 401; with valid key → passes, `apiKeyId` set; revoked key → 401.
- [ ] **Step 2:** fail. **Step 3:** implement. **Step 4:** pass.
- [ ] **Step 5 (test):** `internalAuth` rejects wrong/missing token, accepts correct.

### Task 2.4: `/ingest` endpoint (TDD)
**Files:** Create `apps/api/src/ingest.ts`, wire into `app.ts`; `test/ingest.test.ts`.

**Interfaces — Consumes:** `ClusterClient`, `apiKeyAuth`, `db`.
**Produces:** `POST /ingest` (multipart) → `{ cid, size }`; inserts `uploads` row.

- [ ] **Step 1 (test):** with mocked `ClusterClient.add` + test db, POST file → 200 `{ cid }`, `uploads` row exists with `apiKeyId`.
- [ ] **Step 2:** fail. **Step 3:** implement (stream to cluster, record). **Step 4:** pass.
- [ ] **Step 5 (test):** no API key → 401, cluster not called.

### Task 2.5: Gateway read endpoints
**Files:** Create `apps/api/src/gateway.ts`, wire into `app.ts`; `test/gateway.test.ts`.

**Interfaces — Consumes:** `ClusterClient`, `internalAuth`.
**Produces:** `GET /cluster/peers`, `/cluster/pins`, `/cluster/health`, `/cluster/overview` (aggregate) — all behind `internalAuth`.

- [ ] **Step 1 (test):** `/cluster/peers` without internal token → 401; with token (mocked client) → peers JSON.
- [ ] **Step 2-4:** fail → implement → pass.
- [ ] `/cluster/overview` aggregates peer count, total pins, replication health from the client.

### Task 2.6: Accounting (TDD pure fn + job)
**Files:** Create `apps/api/src/accounting.ts`, `test/accounting.test.ts`.

**Interfaces — Produces:**
- `buildSnapshots(peers, metrics, capturedAt): NewContributionSnapshot[]` — pure.
- `runAccountingJob(deps)` — fetches via client, writes `contribution_snapshots`, upserts `participants.lastSeenAt`.

- [ ] **Step 1 (test):** `buildSnapshots` maps sample peers+metrics → expected snapshot rows (bytesHeld, cidCount, online).
- [ ] **Step 2-4:** fail → implement → pass.
- [ ] Wire an interval runner in `src/index.ts` guarded by `ACCOUNTING_INTERVAL_MS` (skip if unset).

---

## Phase 3 — Next dashboard (`apps/web`)

### Task 3.1: Better Auth + Postgres wiring
**Files:** Modify `apps/web/package.json` (add `better-auth`, `@repo/db`); create `apps/web/lib/auth.ts`, `app/api/auth/[...all]/route.ts`, `middleware.ts`, `lib/auth-client.ts`.

**Interfaces — Produces:** server `auth` instance (Drizzle adapter on `@repo/db`); session-gated dashboard routes via `middleware.ts`; client `authClient`.

- [ ] Configure Better Auth with email/password + Drizzle adapter + `BETTER_AUTH_SECRET`.
- [ ] `middleware.ts` redirects unauthenticated users from `/dashboard/*` to `/login`.
- [ ] Verify: build passes; hitting `/dashboard` unauthenticated redirects.

### Task 3.2: BFF client to Hono
**Files:** Create `apps/web/lib/api.ts`.

**Interfaces — Produces:** `serverFetch(path)` — server-only fetch to `HONO_URL` adding `x-internal-token: INTERNAL_TOKEN`; typed helpers `getOverview()`, `getPeers()`, `getPins()`, `ingest(formData)`.

- [ ] Implement; ensure it's never imported into client components (server-only marker).
- [ ] Verify: `tsc --noEmit`.

### Task 3.3: Login + dashboard shell
**Files:** Create `app/login/page.tsx`, `app/dashboard/layout.tsx`, `app/dashboard/page.tsx` (overview). Use `@repo/ui` components.

- [ ] Login form using `authClient`.
- [ ] Overview page (server component) renders `getOverview()` — cluster health, peer count, total pinned.
- [ ] Verify: build; manual smoke later via compose.

### Task 3.4: Peers/followers + API keys + test upload + onboarding pages
**Files:** Create `app/dashboard/peers/page.tsx`, `app/dashboard/api-keys/page.tsx` (+ server actions to create/revoke keys via `@repo/db`), `app/dashboard/upload/page.tsx` (posts through BFF `ingest`), `app/dashboard/onboarding/page.tsx` (+ action to mint onboarding token and render follower bundle/command).

**Interfaces — Consumes:** `lib/api.ts`, `@repo/db`.
**Produces:** onboarding bundle = `{ clusterName, secret, bootstrapMultiaddr }` + one-line `ipfs-cluster-follow` command string.

- [ ] Peers page lists peers with health/free space/last-seen.
- [ ] API keys page: create (show raw once, store hash) / revoke.
- [ ] Upload page: file form → BFF `ingest` → show CID.
- [ ] Onboarding page: mint token (store in `onboardingTokens`), render bundle + command.
- [ ] Verify: `tsc --noEmit` + build.

---

## Phase 4 — Infrastructure & Docker

### Task 4.1: Kubo + cluster config
**Files:** Create `infra/kubo/` (init notes/entrypoint), `infra/cluster/service.json` template + entrypoint env mapping (CLUSTER_SECRET, trusted_peers, REST API on 9094 bound to internal network).

- [ ] Document required env; ensure cluster points at `kubo` and exposes REST only inside the compose network.

### Task 4.2: Dockerfiles
**Files:** Create `apps/web/Dockerfile` (Next standalone multi-stage), `apps/api/Dockerfile` (Node multi-stage). Add `output: "standalone"` to `apps/web/next.config`.

- [ ] Web: build with pnpm in monorepo (corepack), copy standalone output.
- [ ] API: build TS, run with `@hono/node-server`.
- [ ] Verify: `docker build` for each succeeds.

### Task 4.3: docker-compose stack
**Files:** Create `docker-compose.yml`, `.env.example`.

Services: `kubo`, `cluster`, `postgres`, `api`, `web`, `follower` (Kubo + ipfs-cluster-follow joined to `cluster`). Volumes for ipfs/cluster/pg data. `api` runs db migrate on start.

- [ ] Wire env, depends_on, healthchecks.
- [ ] Verify (integration): `docker compose up` → upload a file via `/ingest` → CID pins on main cluster → replicates to `follower` (assert pin appears on follower's cluster status).

---

## Phase 5 — Wrap-up

### Task 5.1: Root README + scripts
**Files:** Modify root `README.md` (replace turbo boilerplate with project usage), add root scripts (`dev`, `db:migrate`, `compose:up`).

- [ ] Document local dev, env vars, onboarding flow, deploy via Dockerfiles.
- [ ] Verify: `pnpm -w check-types` and `pnpm -w build` pass.

---

## Self-Review Notes

- **Spec coverage:** §3 cluster model → Task 4.1/4.3; §4.1 Hono → Phase 2; §4.2 dashboard → Phase 3; §4.3 db → Phase 1; §5 infra → Phase 4; §6 data flow → Tasks 2.4/2.5/2.6/4.3; §7 auth → 2.3/3.1/3.2; §8 testing → tests in 2.2–2.6 + integration 4.3. All covered.
- **No payout logic** (only `contribution_snapshots`) — honored in 2.6.
- **Type consistency:** `ClusterClient` method names reused identically in 2.4/2.5/2.6; onboarding bundle shape defined once in 3.4.
