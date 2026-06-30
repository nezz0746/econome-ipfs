# `@leconome/cli` — one-command follower join

**Date:** 2026-07-01
**Status:** Approved design, ready for implementation plan

## Goal

Make joining the Econome IPFS cluster "massively easy": one command that an
operator hands to a vetted participant, which stands up a long-lived Kubo +
ipfs-cluster follower and reports the new peer back to the dashboard — with an
interactive experience and ongoing management commands.

This complements (does not replace) the existing `curl … | bash` one-liner,
which stays as the zero-Node fallback.

## Decisions (locked)

- **Distribution:** `npx`, no install. `npx -y @leconome/cli join <url>`.
  Requires Node ≥18 (global `fetch`) and Docker on the participant machine.
  The follower itself persists as a Docker project (`restart: unless-stopped`).
- **Command surface:** full lifecycle — `join`, `status`, `logs`, `stop`,
  `update`.
- **Peer registration:** on join, the CLI reads the follower's cluster peer ID
  and registers it with the dashboard, populating `onboarding_tokens.usedByPeerId`
  and flipping the token's badge from `pending` to `joined`.
- **Config delivery:** content negotiation on the existing join route. The
  server renders the compose files; the CLI writes what it is given (one source
  of truth, server-side).

## Entry point — the one-arg insight

The CLI consumes the **same join URL** the bash one-liner uses, so a single
copyable string serves both paths:

```
curl -fsSL https://host/join/onb_xxx | bash          # no Node
npx -y @leconome/cli join https://host/join/onb_xxx  # Node, interactive, lifecycle
```

The CLI parses the URL into `{ origin, token }`, fetches config from that exact
URL (with `Accept: application/json`), and sends registration to
`<origin>/join/<token>/register`. Running `join` with no URL prompts for it
interactively.

## Components

### 1. New package `packages/cli` → `@leconome/cli`

- Published under the `@leconome` scope (bin name: `econome`).
- Built with `tsup` (mirrors `packages/payload-storage-ipfs`).
- `engines.node >= 18`; runtime guard that prints a clear message on older Node.
- Dependencies kept minimal: `commander` (command parsing) and `@clack/prompts`
  (interactive prompts + spinners). Docker is driven through `child_process`;
  HTTP uses the global `fetch`.
- Publishing wiring:
  - Removed from the `ignore` list in `.changeset/config.json`.
  - Added to the build filter in the root `release` script and in
    `.github/workflows/publish.yml`.

### 2. Server changes (`apps/web`)

- **Refactor** `apps/web/lib/cluster-config.ts`: extract
  `buildFollowerComposeFiles(bundle) → { composeYaml, kuboInitSh }`. Both
  `buildDockerJoinScript` (which embeds the files via heredocs) and the new JSON
  response consume it. Single definition of the follower topology.
- **Content-negotiate** `apps/web/app/join/[token]/route.ts`:
  - `Accept: application/json` → `200 { clusterName, compose, kuboInit }`.
  - Otherwise → bash script, exactly as today.
  - Error cases (unknown/expired token, cluster not configured): for the JSON
    path return `{ error: string }` (HTTP 200, so the CLI reads the body and
    prints it); for the bash path keep the current error-echo script.
- **New route** `POST /join/[token]/register` with body `{ peerId: string }`:
  validates the token exists (token in path is the credential), then sets
  `onboarding_tokens.usedByPeerId = peerId` for that token. Returns
  `200 { ok: true }`. Unknown token → `404`. Idempotent (re-register overwrites).

### 3. CLI commands

All commands operate on a project directory `~/.econome/` containing
`docker-compose.yml`, `kubo-init.sh`, and `config.json`
(`{ server, token, clusterName }`). Note this is intentionally distinct from the
bash installer's `~/econome-follower`: the two installers are alternatives, not
meant to be combined. On `join`, if `~/econome-follower` exists (a prior
bash-installed follower), the CLI warns that a follower may already be running
there before proceeding.

- `join [url]` — full flow (see Data flow). Interactive prompt if `url` omitted.
- `status` — is the project running; is the cluster peer connected/replicating;
  pin count (via `docker compose exec -T cluster ipfs-cluster-ctl status`/`id`).
- `logs [-f]` — tail the follower (cluster + kubo) logs.
- `stop` — `docker compose down` (keeps data volumes).
- `update` — `docker compose pull` then `up -d`.

A thin internal `docker` wrapper module (`up`, `down`, `pull`, `exec`,
`isAvailable`) isolates all `child_process` calls so orchestration logic is
unit-testable without a real daemon.

### 4. Onboarding page (`apps/web/app/dashboard/onboarding/page.tsx`)

Lead with the per-token `npx` command (copyable), keep the existing
`curl … | bash` one-liner as the labeled "no Node" fallback. A
`npxJoinCommand(token)` helper in `cluster-config.ts` builds it from the same
base URL as `joinCommand`.

## Data flow — `join`

```
npx @leconome/cli join <url>
  → parse url → { origin, token }
  → check Docker + compose          (spinner; hard-fail with get-docker URL if absent)
  → GET <url>  (Accept: application/json) → { clusterName, compose, kuboInit }
       └─ if body has { error } → print and exit 1
  → write ~/.econome/{docker-compose.yml, kubo-init.sh, config.json}
  → docker compose up -d            (spinner)
  → poll `ipfs-cluster-ctl id`      until peer id appears (timeout ~60s)
  → POST <origin>/join/<token>/register { peerId }   (warn-only on failure)
  → outro: "Replicating <clusterName>. Manage with: econome status | logs | stop"
```

## Error handling

- **No Docker / compose:** stop before writing any files; print the
  get-docker.com URL.
- **Bad/expired token:** server returns `{ error }`; CLI prints it, exits 1.
- **Peer never comes up (timeout):** the follower is already launched; advise
  `econome logs`; do not crash or roll back.
- **Registration failure (dashboard unreachable):** warn but treat join as
  success — the follower is replicating; registration is cosmetic and can be
  retried by re-running `join`.
- **Re-run / already joined:** `compose up -d` is idempotent; an existing
  `~/.econome/config.json` is reused/refreshed rather than erroring.

## Testing

- **Server (TDD):**
  - `buildFollowerComposeFiles` — emits valid YAML with `CLUSTER_SECRET`,
    `CLUSTER_PEERADDRESSES` (bootstrap), and `CLUSTER_CRDT_TRUSTEDPEERS` (main
    peer id) correctly wired; kubo init binds the API.
  - Join route content negotiation — bash vs JSON by `Accept`; error shapes per
    path.
  - Register handler — sets `usedByPeerId`; unknown token → 404.
- **CLI:**
  - URL parsing → `{ origin, token }` (valid, trailing slash, bad input).
  - Config fetch — success and `{ error }` handling (mock `fetch`).
  - Project-file writing — files land in a fake project dir with expected
    contents.
  - Orchestration via the mockable `docker` wrapper (no real daemon); peer-id
    poll loop with a fake `exec`.
  - One manual smoke test (documented): real `join` against a live dashboard +
    Docker, then `status`/`logs`/`stop`.

## Out of scope (YAGNI)

- Self-contained binary distribution (no-Node path stays `curl | bash`).
- Windows-native support beyond what Docker Desktop + Node provide.
- Auto-update of the CLI itself (npx always fetches latest).
- Token single-use enforcement / expiry management (separate concern; the
  register endpoint only records the peer id).
