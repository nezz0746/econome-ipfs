# `@leconome/cli` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a published `@leconome/cli` (`npx -y @leconome/cli join <url>`) that stands up a long-lived Dockerized Kubo + ipfs-cluster follower, registers the new peer with the dashboard, and manages it (`status`/`logs`/`stop`/`update`).

**Architecture:** A new `packages/cli` package built with `tsup`, driven by `commander` + `@clack/prompts`, orchestrating Docker via a thin mockable wrapper. The dashboard's existing join route gains content negotiation: it renders the compose files server-side and returns them as JSON to the CLI (the bash one-liner is unchanged). A new register route records the peer id. The compose-rendering logic is extracted from the `server-only` `cluster-config.ts` into a pure, unit-tested module shared by both the bash and JSON paths.

**Tech Stack:** TypeScript, Node ≥18 (global `fetch`), pnpm workspace, tsup, vitest, commander, @clack/prompts, Next 16 route handlers, Drizzle/Postgres.

## Global Constraints

- Package name: `@leconome/cli`; binary name: `econome`. (Scope matches the existing `@leconome/payload-storage-ipfs`.)
- Node ≥18 required (uses global `fetch`); declare `engines.node >= 18`.
- Participant machine must have Docker + Docker Compose; the CLI never installs them, only detects and instructs.
- CLI project directory: `~/.econome/` holding `docker-compose.yml`, `kubo-init.sh`, `config.json`. Distinct from the bash installer's `~/econome-follower`.
- One source of truth for the follower topology: the server renders compose; the CLI writes what it receives.
- Dependencies kept minimal: CLI runtime deps are exactly `commander` and `@clack/prompts`.
- Lint/format with Biome (repo root `biome.json`); every commit must pass `pnpm exec biome check`.
- pnpm@9, `pnpm install` after any new package/dependency.

---

## File Structure

**Server (`apps/web`):**
- Create `lib/follower-compose.ts` — pure (NO `server-only`): `buildFollowerComposeFiles(bundle)`, `buildDockerJoinScript(bundle)`, `wantsJson(accept)`. Moved out of `cluster-config.ts`.
- Create `lib/follower-compose.test.ts` — vitest unit tests.
- Modify `lib/cluster-config.ts` — keep env-bound helpers (`buildFollowerBundle`, `appBaseUrl`, `joinCommand`); add `npxJoinCommand(token)`; delete the moved compose code; re-export nothing it no longer owns.
- Modify `app/join/[token]/route.ts` — content negotiation (bash vs JSON) via `wantsJson`.
- Create `app/join/[token]/register/route.ts` — `POST { peerId }` → set `usedByPeerId`.
- Modify `app/dashboard/onboarding/page.tsx` — show the `npx` command per token; keep `curl` as fallback.
- Create `vitest.config.ts`; modify `package.json` (add `test` script + `vitest` dev dep).

**CLI (`packages/cli`):** `@leconome/cli`
- `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`
- `src/index.ts` — commander entrypoint (shebang via tsup banner)
- `src/lib/join-url.ts` (+ `.test.ts`) — `parseJoinUrl`
- `src/lib/config.ts` (+ `.test.ts`) — `fetchFollowerConfig`, types
- `src/lib/project.ts` (+ `.test.ts`) — `projectDir`, `writeProject`, `readProjectConfig`
- `src/lib/docker.ts` — thin `child_process` wrapper (mockable)
- `src/lib/peer.ts` (+ `.test.ts`) — `parsePeerId`, `pollPeerId`
- `src/lib/register.ts` (+ `.test.ts`) — `registerPeer`
- `src/commands/{join,status,logs,stop,update}.ts`

**Repo wiring:**
- Modify `.changeset/config.json` (ensure `@leconome/cli` is publishable — it must NOT be in `ignore`).
- Modify root `package.json` `release` script (add `--filter=@leconome/cli`).
- Modify `.github/workflows/publish.yml` (add `--filter=@leconome/cli` to the build step).
- Create `.changeset/leconome-cli.md` (initial `minor`).

---

## Task 1: Extract pure follower-compose module + web test infra

**Files:**
- Create: `apps/web/lib/follower-compose.ts`
- Create: `apps/web/lib/follower-compose.test.ts`
- Create: `apps/web/vitest.config.ts`
- Modify: `apps/web/package.json`
- Modify: `apps/web/lib/cluster-config.ts`

**Interfaces:**
- Produces: `buildFollowerComposeFiles(bundle: FollowerBundle): { composeYaml: string; kuboInitSh: string }`
- Produces: `buildDockerJoinScript(bundle: FollowerBundle): string`
- Produces: `wantsJson(accept: string | null): boolean`
- Consumes: `FollowerBundle` (from `cluster-config.ts`: `{ clusterName, secret, bootstrapMultiaddr, command }`)

- [ ] **Step 1: Add vitest to the web app**

Modify `apps/web/package.json` — add a script and dev dep:

```json
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "check-types": "next typegen && tsc --noEmit"
  },
```

Add to `devDependencies`: `"vitest": "^3.2.4"`.

Create `apps/web/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
```

Run: `pnpm install`
Expected: installs vitest into `apps/web`.

- [ ] **Step 2: Write the failing test**

Create `apps/web/lib/follower-compose.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildDockerJoinScript,
  buildFollowerComposeFiles,
  wantsJson,
} from "./follower-compose";

const bundle = {
  clusterName: "econome",
  secret: "deadbeef0123456789abcdef",
  bootstrapMultiaddr:
    "/dns4/host.example/tcp/9096/p2p/12D3KooWMainPeerIdExample",
  command: "ignored",
};

describe("buildFollowerComposeFiles", () => {
  it("wires the secret, bootstrap, and trusted peer into the compose", () => {
    const { composeYaml, kuboInitSh } = buildFollowerComposeFiles(bundle);
    expect(composeYaml).toContain('CLUSTER_SECRET: "deadbeef0123456789abcdef"');
    expect(composeYaml).toContain(
      'CLUSTER_PEERADDRESSES: "/dns4/host.example/tcp/9096/p2p/12D3KooWMainPeerIdExample"',
    );
    // Trust only the main peer (id parsed from the bootstrap multiaddr).
    expect(composeYaml).toContain(
      'CLUSTER_CRDT_TRUSTEDPEERS: "12D3KooWMainPeerIdExample"',
    );
    expect(composeYaml).toContain("./kubo-init.sh:/container-init.d/001-config.sh:ro");
    expect(kuboInitSh).toContain("Addresses.API /ip4/0.0.0.0/tcp/5001");
  });

  it("falls back to trusting all peers when no peer id is present", () => {
    const { composeYaml } = buildFollowerComposeFiles({
      ...bundle,
      bootstrapMultiaddr: "/dns4/host.example/tcp/9096",
    });
    expect(composeYaml).toContain('CLUSTER_CRDT_TRUSTEDPEERS: "*"');
  });
});

describe("buildDockerJoinScript", () => {
  it("embeds the rendered compose + kubo init via heredocs", () => {
    const script = buildDockerJoinScript(bundle);
    expect(script.startsWith("#!/usr/bin/env bash")).toBe(true);
    expect(script).toContain("cat > docker-compose.yml <<'COMPOSE_EOF'");
    expect(script).toContain('CLUSTER_SECRET: "deadbeef0123456789abcdef"');
    expect(script).toContain("cat > kubo-init.sh <<'KUBO_EOF'");
  });
});

describe("wantsJson", () => {
  it("is true only when the Accept header requests JSON", () => {
    expect(wantsJson("application/json")).toBe(true);
    expect(wantsJson("text/html, application/json;q=0.9")).toBe(true);
    expect(wantsJson("*/*")).toBe(false);
    expect(wantsJson(null)).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run lib/follower-compose.test.ts`
Expected: FAIL — `Cannot find module './follower-compose'`.

- [ ] **Step 4: Create the module (move logic out of cluster-config)**

Create `apps/web/lib/follower-compose.ts` — note: NO `server-only` import, so it is unit-testable:

```ts
import type { FollowerBundle } from "./cluster-config";

/** Single-quote a value for safe interpolation into the generated bash. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Render the follower's Docker files (compose + kubo init) for a cluster
 * bundle. Single source of truth for the follower topology, shared by the
 * bash join script and the JSON join response.
 */
export function buildFollowerComposeFiles(bundle: FollowerBundle): {
  composeYaml: string;
  kuboInitSh: string;
} {
  const { secret, bootstrapMultiaddr } = bundle;
  // Trust only the main peer (the id embedded in the bootstrap multiaddr) so a
  // follower replicates read-only rather than trusting every CRDT peer.
  const mainPeerId = bootstrapMultiaddr.split("/p2p/")[1] ?? "";
  const trustedPeers = mainPeerId || "*";

  const kuboInitSh = `#!/bin/sh
set -e
ipfs config Addresses.API /ip4/0.0.0.0/tcp/5001
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["*"]'
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '["PUT","POST","GET"]'
`;

  const composeYaml = `services:
  kubo:
    image: ipfs/kubo:latest
    restart: unless-stopped
    volumes:
      - ./ipfs-data:/data/ipfs
      - ./kubo-init.sh:/container-init.d/001-config.sh:ro

  cluster:
    image: ipfs/ipfs-cluster:latest
    restart: unless-stopped
    depends_on:
      - kubo
    environment:
      CLUSTER_SECRET: "${secret}"
      CLUSTER_IPFSHTTP_NODEMULTIADDRESS: /dns4/kubo/tcp/5001
      CLUSTER_CRDT_TRUSTEDPEERS: "${trustedPeers}"
      CLUSTER_PEERADDRESSES: "${bootstrapMultiaddr}"
    volumes:
      - ./cluster-data:/data/ipfs-cluster
`;

  return { composeYaml, kuboInitSh };
}

/**
 * Build the Docker-based join script served at `/join/[token]` for the
 * `curl … | bash` path. Embeds the rendered files via quoted heredocs.
 */
export function buildDockerJoinScript(bundle: FollowerBundle): string {
  const { clusterName } = bundle;
  const { composeYaml, kuboInitSh } = buildFollowerComposeFiles(bundle);

  return `#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Econome follower join script (Docker). Generated per onboarding token.
# Runs a Kubo node + ipfs-cluster peer that replicates the company pinset.
# ---------------------------------------------------------------------------

CLUSTER_NAME=${shellQuote(clusterName)}
DIR="\${ECONOME_DIR:-$HOME/econome-follower}"

echo "==> Econome follower setup"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is not installed. See https://docs.docker.com/get-docker/" >&2
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo "ERROR: Docker Compose is not available." >&2
  exit 1
fi

mkdir -p "$DIR"
cd "$DIR"

cat > kubo-init.sh <<'KUBO_EOF'
${kuboInitSh}KUBO_EOF

cat > docker-compose.yml <<'COMPOSE_EOF'
${composeYaml}COMPOSE_EOF

echo "==> Starting follower in $DIR"
$COMPOSE up -d

echo ""
echo "Done. This node is now replicating the $CLUSTER_NAME pinset."
echo "  Logs:  (cd $DIR && $COMPOSE logs -f cluster)"
echo "  Stop:  (cd $DIR && $COMPOSE down)"
`;
}

/** True when the request's Accept header asks for JSON (the CLI path). */
export function wantsJson(accept: string | null): boolean {
  return (accept ?? "").includes("application/json");
}
```

- [ ] **Step 5: Trim `cluster-config.ts` to its env-bound responsibilities**

In `apps/web/lib/cluster-config.ts`, DELETE `shellQuote` and `buildDockerJoinScript` (now in `follower-compose.ts`). Keep `FollowerBundle`, `buildFollowerBundle`, `appBaseUrl`, `joinCommand`. The file still begins with `import "server-only";`. Add `npxJoinCommand`:

```ts
/** The `npx @leconome/cli join …` one-liner for a given token. */
export function npxJoinCommand(token: string): string {
  return `npx -y @leconome/cli join ${appBaseUrl()}/join/${token}`;
}
```

- [ ] **Step 6: Point the join route at the moved function**

In `apps/web/app/join/[token]/route.ts`, change the import:

```ts
import { buildFollowerBundle } from "@/lib/cluster-config";
import { buildDockerJoinScript } from "@/lib/follower-compose";
```

(Leave the rest of the route as-is for now; Task 2 adds negotiation.)

- [ ] **Step 7: Run tests + types + lint**

Run: `pnpm --filter web exec vitest run lib/follower-compose.test.ts`
Expected: PASS (5 tests).

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no errors.

Run: `pnpm exec biome check --write apps/web/lib/follower-compose.ts apps/web/lib/follower-compose.test.ts apps/web/lib/cluster-config.ts apps/web/vitest.config.ts`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/follower-compose.ts apps/web/lib/follower-compose.test.ts apps/web/lib/cluster-config.ts apps/web/vitest.config.ts apps/web/package.json pnpm-lock.yaml apps/web/app/join/\[token\]/route.ts
git commit -m "refactor: extract pure follower-compose module + web vitest"
```

---

## Task 2: Join route content negotiation + onboarding npx command

**Files:**
- Modify: `apps/web/app/join/[token]/route.ts`
- Modify: `apps/web/app/dashboard/onboarding/page.tsx`

**Interfaces:**
- Consumes: `buildFollowerComposeFiles`, `buildDockerJoinScript`, `wantsJson` (Task 1); `buildFollowerBundle`, `npxJoinCommand` (Task 1).
- Produces (HTTP): `GET /join/:token` with `Accept: application/json` → `200 { clusterName, compose, kuboInit }` or `200 { error }`.

- [ ] **Step 1: Add the JSON branch to the route**

Replace the body of `GET` in `apps/web/app/join/[token]/route.ts` so each exit point honors the Accept header. Full file:

```ts
import { getDb, onboardingTokens } from "@repo/db";
import { eq } from "drizzle-orm";

import { buildFollowerBundle } from "@/lib/cluster-config";
import {
  buildDockerJoinScript,
  buildFollowerComposeFiles,
  wantsJson,
} from "@/lib/follower-compose";

// Public, token-gated endpoint — no session. The onboarding token is the
// credential. Always rendered dynamically (DB lookup + live cluster env).
export const dynamic = "force-dynamic";

function scriptResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * Error result. Both paths return HTTP 200 with a readable body: the bash path
 * prints + exits 1 (survives `curl -fsSL`, where `-f` discards error-status
 * bodies); the JSON path returns `{ error }` for the CLI to display.
 */
function errorResult(json: boolean, message: string): Response {
  if (json) return jsonResponse({ error: message });
  return scriptResponse(
    `#!/usr/bin/env bash\necho "Econome join failed: ${message}" >&2\nexit 1\n`,
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const json = wantsJson(request.headers.get("accept"));

  const [row] = await getDb()
    .select({
      id: onboardingTokens.id,
      expiresAt: onboardingTokens.expiresAt,
    })
    .from(onboardingTokens)
    .where(eq(onboardingTokens.token, token))
    .limit(1);

  if (!row) {
    return errorResult(json, "invalid or unknown onboarding token.");
  }
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return errorResult(json, "this onboarding token has expired.");
  }

  const bundle = buildFollowerBundle();
  if (!bundle.secret || !bundle.bootstrapMultiaddr) {
    return errorResult(
      json,
      "the storage center is not yet configured for joins (the operator must set CLUSTER_BOOTSTRAP, and CLUSTER_SECRET, on the dashboard).",
    );
  }

  if (json) {
    const { composeYaml, kuboInitSh } = buildFollowerComposeFiles(bundle);
    return jsonResponse({
      clusterName: bundle.clusterName,
      compose: composeYaml,
      kuboInit: kuboInitSh,
    });
  }

  return scriptResponse(buildDockerJoinScript(bundle));
}
```

- [ ] **Step 2: Verify negotiation by hand**

Run (dashboard must be running locally with a valid token, or skip to type/lint):
```bash
curl -s -H 'accept: application/json' http://localhost:3000/join/<token> | head -c 200
```
Expected: a JSON object containing `"compose"` (or `{"error":...}` if misconfigured), NOT a bash script.

- [ ] **Step 3: Show the npx command on the onboarding page**

In `apps/web/app/dashboard/onboarding/page.tsx`:

Update the import:
```ts
import {
  buildFollowerBundle,
  joinCommand,
  npxJoinCommand,
} from "@/lib/cluster-config";
```

Replace the "One-line join command (Docker)" code block (the `curl` one) so the **npx** command leads, with `curl` as fallback. Replace this block:

```tsx
            <div className="flex items-center gap-1">
              <code className="flex-1 rounded-md bg-muted px-3 py-2 font-mono text-sm break-all">
                {joinCommand("<token>")}
              </code>
              <CopyButton
                value={joinCommand("<token>")}
                label="Command copied"
              />
            </div>
```

with:

```tsx
            <div className="flex items-center gap-1">
              <code className="flex-1 rounded-md bg-muted px-3 py-2 font-mono text-sm break-all">
                {npxJoinCommand("<token>")}
              </code>
              <CopyButton
                value={npxJoinCommand("<token>")}
                label="Command copied"
              />
            </div>
            <p className="mt-2 mb-1 text-sm text-muted-foreground">
              Or, no Node — curl | bash
            </p>
            <div className="rounded-md bg-muted px-3 py-2 font-mono text-sm break-all">
              {joinCommand("<token>")}
            </div>
```

In the tokens table, switch the per-token command to the npx form. Replace `joinCommand(token.token)` (both occurrences in the table cell) with `npxJoinCommand(token.token)`.

- [ ] **Step 4: Types + lint**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no errors.

Run: `pnpm exec biome check --write 'apps/web/app/join/[token]/route.ts' apps/web/app/dashboard/onboarding/page.tsx`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/join/\[token\]/route.ts apps/web/app/dashboard/onboarding/page.tsx
git commit -m "feat(web): JSON content negotiation on join route + npx command"
```

---

## Task 3: Peer registration route

**Files:**
- Create: `apps/web/app/join/[token]/register/route.ts`

**Interfaces:**
- Produces (HTTP): `POST /join/:token/register` body `{ peerId: string }` → `200 { ok: true }`; unknown token → `404 { error }`; bad body → `400 { error }`.
- Consumes: `onboardingTokens` table (`token`, `usedByPeerId`).

- [ ] **Step 1: Create the register route**

Create `apps/web/app/join/[token]/register/route.ts`:

```ts
import { getDb, onboardingTokens } from "@repo/db";
import { eq } from "drizzle-orm";

// Public, token-gated: the token in the path is the credential.
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;

  let peerId: unknown;
  try {
    peerId = (await request.json())?.peerId;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  if (typeof peerId !== "string" || peerId.length === 0) {
    return json({ error: "peerId is required" }, 400);
  }

  const db = getDb();
  const [row] = await db
    .select({ id: onboardingTokens.id })
    .from(onboardingTokens)
    .where(eq(onboardingTokens.token, token))
    .limit(1);

  if (!row) {
    return json({ error: "invalid or unknown onboarding token" }, 404);
  }

  await db
    .update(onboardingTokens)
    .set({ usedByPeerId: peerId })
    .where(eq(onboardingTokens.id, row.id));

  return json({ ok: true });
}
```

- [ ] **Step 2: Types + lint**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no errors.

Run: `pnpm exec biome check --write 'apps/web/app/join/[token]/register/route.ts'`
Expected: clean.

- [ ] **Step 3: Manual smoke (optional, needs running dashboard + token)**

```bash
curl -s -X POST http://localhost:3000/join/<token>/register \
  -H 'content-type: application/json' -d '{"peerId":"12D3KooWTest"}'
```
Expected: `{"ok":true}`. The Onboarding page now shows that token as `joined`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/join/\[token\]/register/route.ts
git commit -m "feat(web): peer registration route records usedByPeerId"
```

---

## Task 4: Scaffold `@leconome/cli` package + publishing wiring

**Files:**
- Create: `packages/cli/package.json`, `packages/cli/tsconfig.json`, `packages/cli/tsup.config.ts`, `packages/cli/vitest.config.ts`, `packages/cli/src/index.ts`, `packages/cli/README.md`
- Modify: root `package.json`, `.github/workflows/publish.yml`, `.changeset/config.json`
- Create: `.changeset/leconome-cli.md`

**Interfaces:**
- Produces: an installable bin `econome` whose `--help` lists `join`, `status`, `logs`, `stop`, `update`.

- [ ] **Step 1: Create the package manifest**

Create `packages/cli/package.json`:

```json
{
  "name": "@leconome/cli",
  "version": "0.1.0",
  "description": "One-command CLI to join the Econome IPFS cluster as a follower.",
  "keywords": ["ipfs", "ipfs-cluster", "econome", "cli"],
  "license": "MIT",
  "type": "module",
  "bin": {
    "econome": "./dist/index.js"
  },
  "files": ["dist"],
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "build": "tsup",
    "check-types": "tsc --noEmit",
    "test": "vitest run",
    "prepublishOnly": "tsup"
  },
  "dependencies": {
    "@clack/prompts": "^0.11.0",
    "commander": "^14.0.0"
  },
  "devDependencies": {
    "@repo/typescript-config": "workspace:*",
    "@types/node": "^22.15.3",
    "tsup": "^8.3.5",
    "typescript": "5.9.2",
    "vitest": "^3.2.4"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

- [ ] **Step 2: Create tsconfig, tsup, vitest configs**

Create `packages/cli/tsconfig.json`:

```json
{
  "extends": "@repo/typescript-config/base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

Create `packages/cli/tsup.config.ts`:

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  sourcemap: true,
  // Make the built entry directly executable as `econome`.
  banner: { js: "#!/usr/bin/env node" },
});
```

Create `packages/cli/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Create a minimal commander entrypoint**

Create `packages/cli/src/index.ts`:

```ts
import { Command } from "commander";

const program = new Command();

program
  .name("econome")
  .description("Join and manage an Econome IPFS cluster follower.")
  .version("0.1.0");

program
  .command("join")
  .argument("[url]", "join URL from the dashboard onboarding page")
  .description("Start a follower that replicates the cluster pinset")
  .action(async (url?: string) => {
    const { join } = await import("./commands/join.js");
    await join(url);
  });

program
  .command("status")
  .description("Show whether the follower is running and replicating")
  .action(async () => {
    const { status } = await import("./commands/status.js");
    await status();
  });

program
  .command("logs")
  .option("-f, --follow", "follow log output")
  .description("Show follower logs")
  .action(async (opts: { follow?: boolean }) => {
    const { logs } = await import("./commands/logs.js");
    await logs(Boolean(opts.follow));
  });

program
  .command("stop")
  .description("Stop the follower (keeps data)")
  .action(async () => {
    const { stop } = await import("./commands/stop.js");
    await stop();
  });

program
  .command("update")
  .description("Pull newer images and restart the follower")
  .action(async () => {
    const { update } = await import("./commands/update.js");
    await update();
  });

program.parseAsync();
```

Create placeholder command modules so the build compiles (each replaced in later tasks). Create `packages/cli/src/commands/join.ts`:

```ts
export async function join(_url?: string): Promise<void> {
  throw new Error("not implemented");
}
```

Create `packages/cli/src/commands/status.ts`, `logs.ts`, `stop.ts`, `update.ts` with the same shape:

```ts
// status.ts
export async function status(): Promise<void> {
  throw new Error("not implemented");
}
```
```ts
// logs.ts
export async function logs(_follow: boolean): Promise<void> {
  throw new Error("not implemented");
}
```
```ts
// stop.ts
export async function stop(): Promise<void> {
  throw new Error("not implemented");
}
```
```ts
// update.ts
export async function update(): Promise<void> {
  throw new Error("not implemented");
}
```

Create `packages/cli/README.md`:

```markdown
# @leconome/cli

One command to join the Econome IPFS cluster as a follower.

```bash
npx -y @leconome/cli join <join-url-from-dashboard>
```

Requires Docker. Manage with `econome status | logs | stop | update`.
```

- [ ] **Step 4: Wire publishing**

In root `package.json`, extend the `release` script filter:

```json
    "release": "turbo run build --filter=@leconome/payload-storage-ipfs --filter=@leconome/cli && changeset publish"
```

In `.github/workflows/publish.yml`, change the build step:

```yaml
      - name: Build all publishable packages
        run: pnpm build --filter=@leconome/payload-storage-ipfs --filter=@leconome/cli
```

Confirm `.changeset/config.json` `ignore` does NOT contain `@leconome/cli` (it should already be absent — leave the array unchanged).

Create `.changeset/leconome-cli.md`:

```markdown
---
"@leconome/cli": minor
---

Initial release. `npx @leconome/cli join <url>` stands up a Dockerized Kubo +
ipfs-cluster follower from a dashboard onboarding link, registers the peer with
the dashboard, and manages it via `status`, `logs`, `stop`, and `update`.
```

- [ ] **Step 5: Install, build, verify the bin**

Run: `pnpm install`
Expected: links `@leconome/cli` into the workspace.

Run: `pnpm --filter @leconome/cli build`
Expected: emits `packages/cli/dist/index.js` starting with `#!/usr/bin/env node`.

Run: `node packages/cli/dist/index.js --help`
Expected: usage text listing `join`, `status`, `logs`, `stop`, `update`.

Run: `pnpm exec biome check --write packages/cli/src`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/cli .changeset/leconome-cli.md package.json .github/workflows/publish.yml pnpm-lock.yaml
git commit -m "feat(cli): scaffold @leconome/cli package + publishing wiring"
```

---

## Task 5: `parseJoinUrl`

**Files:**
- Create: `packages/cli/src/lib/join-url.ts`, `packages/cli/src/lib/join-url.test.ts`

**Interfaces:**
- Produces: `parseJoinUrl(input: string): { origin: string; token: string }` — throws `Error` with a friendly message on invalid input.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/lib/join-url.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseJoinUrl } from "./join-url";

describe("parseJoinUrl", () => {
  it("splits a join URL into origin and token", () => {
    expect(parseJoinUrl("https://host.example/join/onb_abc123")).toEqual({
      origin: "https://host.example",
      token: "onb_abc123",
    });
  });

  it("tolerates a trailing slash", () => {
    expect(parseJoinUrl("https://host.example/join/onb_abc123/")).toEqual({
      origin: "https://host.example",
      token: "onb_abc123",
    });
  });

  it("throws on a URL without a /join/<token> path", () => {
    expect(() => parseJoinUrl("https://host.example/")).toThrow();
  });

  it("throws on non-URL input", () => {
    expect(() => parseJoinUrl("not a url")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @leconome/cli exec vitest run src/lib/join-url.test.ts`
Expected: FAIL — `Cannot find module './join-url'`.

- [ ] **Step 3: Implement**

Create `packages/cli/src/lib/join-url.ts`:

```ts
/**
 * Parse a dashboard join URL (e.g. `https://host/join/onb_abc`) into the
 * server origin and onboarding token. Throws a friendly Error on bad input.
 */
export function parseJoinUrl(input: string): { origin: string; token: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(`"${input}" is not a valid URL.`);
  }

  const parts = url.pathname.split("/").filter(Boolean); // drops empties
  if (parts.length < 2 || parts[0] !== "join") {
    throw new Error(
      `"${input}" is not a join URL (expected …/join/<token>).`,
    );
  }
  const token = parts[1];
  return { origin: url.origin, token };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @leconome/cli exec vitest run src/lib/join-url.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/join-url.ts packages/cli/src/lib/join-url.test.ts
git commit -m "feat(cli): parseJoinUrl"
```

---

## Task 6: `fetchFollowerConfig` + types

**Files:**
- Create: `packages/cli/src/lib/config.ts`, `packages/cli/src/lib/config.test.ts`

**Interfaces:**
- Produces: type `FollowerConfig = { clusterName: string; compose: string; kuboInit: string }`
- Produces: `fetchFollowerConfig(url: string): Promise<FollowerConfig>` — GET `url` with `Accept: application/json`; throws `Error(body.error)` when the server returns `{ error }`, or a network/parse error otherwise.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/lib/config.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFollowerConfig } from "./config";

function mockFetch(body: unknown, ok = true) {
  return vi.fn(async () => ({
    ok,
    json: async () => body,
  })) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchFollowerConfig", () => {
  it("returns the follower config on success", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ clusterName: "econome", compose: "services:\n", kuboInit: "#!/bin/sh\n" }),
    );
    const cfg = await fetchFollowerConfig("https://host/join/onb_x");
    expect(cfg.clusterName).toBe("econome");
    expect(cfg.compose).toContain("services:");
  });

  it("throws the server's error message", async () => {
    vi.stubGlobal("fetch", mockFetch({ error: "this onboarding token has expired." }));
    await expect(fetchFollowerConfig("https://host/join/onb_x")).rejects.toThrow(
      "this onboarding token has expired.",
    );
  });

  it("throws when the response is missing compose", async () => {
    vi.stubGlobal("fetch", mockFetch({ clusterName: "econome" }));
    await expect(fetchFollowerConfig("https://host/join/onb_x")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @leconome/cli exec vitest run src/lib/config.test.ts`
Expected: FAIL — `Cannot find module './config'`.

- [ ] **Step 3: Implement**

Create `packages/cli/src/lib/config.ts`:

```ts
export interface FollowerConfig {
  clusterName: string;
  compose: string;
  kuboInit: string;
}

/**
 * Fetch the rendered follower config from a dashboard join URL. The server
 * returns `{ clusterName, compose, kuboInit }` on success or `{ error }` for an
 * invalid/expired token or unconfigured cluster.
 */
export async function fetchFollowerConfig(url: string): Promise<FollowerConfig> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" } });
  } catch (err) {
    throw new Error(
      `Could not reach the dashboard at ${url}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(`The dashboard returned a non-JSON response (HTTP ${res.status}).`);
  }

  if (body && typeof body === "object" && "error" in body) {
    throw new Error(String((body as { error: unknown }).error));
  }

  const cfg = body as Partial<FollowerConfig>;
  if (!cfg || typeof cfg.compose !== "string" || typeof cfg.kuboInit !== "string") {
    throw new Error("The dashboard response was missing the follower config.");
  }
  return {
    clusterName: typeof cfg.clusterName === "string" ? cfg.clusterName : "econome",
    compose: cfg.compose,
    kuboInit: cfg.kuboInit,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @leconome/cli exec vitest run src/lib/config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/config.ts packages/cli/src/lib/config.test.ts
git commit -m "feat(cli): fetchFollowerConfig"
```

---

## Task 7: Project directory + file writing

**Files:**
- Create: `packages/cli/src/lib/project.ts`, `packages/cli/src/lib/project.test.ts`

**Interfaces:**
- Produces: type `ProjectConfig = { server: string; token: string; clusterName: string }`
- Produces: `projectDir(): string` — defaults to `~/.econome`, overridable with `ECONOME_DIR`.
- Produces: `writeProject(dir: string, cfg: FollowerConfig, meta: ProjectConfig): Promise<void>` — writes `docker-compose.yml`, `kubo-init.sh`, `config.json`.
- Produces: `readProjectConfig(dir: string): Promise<ProjectConfig | null>`.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/lib/project.test.ts`:

```ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readProjectConfig, writeProject } from "./project";

describe("writeProject / readProjectConfig", () => {
  it("writes the compose, kubo init, and config files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "econome-test-"));
    await writeProject(
      dir,
      { clusterName: "econome", compose: "services: {}\n", kuboInit: "#!/bin/sh\n" },
      { server: "https://host", token: "onb_x", clusterName: "econome" },
    );

    expect(readFileSync(join(dir, "docker-compose.yml"), "utf8")).toContain("services:");
    expect(readFileSync(join(dir, "kubo-init.sh"), "utf8")).toContain("#!/bin/sh");

    const cfg = await readProjectConfig(dir);
    expect(cfg).toEqual({
      server: "https://host",
      token: "onb_x",
      clusterName: "econome",
    });
  });

  it("returns null when no config exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "econome-test-"));
    expect(await readProjectConfig(dir)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @leconome/cli exec vitest run src/lib/project.test.ts`
Expected: FAIL — `Cannot find module './project'`.

- [ ] **Step 3: Implement**

Create `packages/cli/src/lib/project.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FollowerConfig } from "./config";

export interface ProjectConfig {
  server: string;
  token: string;
  clusterName: string;
}

/** The follower project directory (`~/.econome`, overridable via ECONOME_DIR). */
export function projectDir(): string {
  return process.env.ECONOME_DIR ?? join(homedir(), ".econome");
}

/** Write the compose, kubo init, and config files into `dir` (created if needed). */
export async function writeProject(
  dir: string,
  cfg: FollowerConfig,
  meta: ProjectConfig,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "docker-compose.yml"), cfg.compose, "utf8");
  await writeFile(join(dir, "kubo-init.sh"), cfg.kuboInit, "utf8");
  await writeFile(join(dir, "config.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

/** Read the stored project config, or null if the project hasn't been set up. */
export async function readProjectConfig(dir: string): Promise<ProjectConfig | null> {
  try {
    const raw = await readFile(join(dir, "config.json"), "utf8");
    return JSON.parse(raw) as ProjectConfig;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @leconome/cli exec vitest run src/lib/project.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/project.ts packages/cli/src/lib/project.test.ts
git commit -m "feat(cli): project dir + file writing"
```

---

## Task 8: Docker wrapper

**Files:**
- Create: `packages/cli/src/lib/docker.ts`

**Interfaces:**
- Produces:
  - `dockerAvailable(): Promise<boolean>`
  - `composeUp(dir: string): Promise<void>`
  - `composeDown(dir: string): Promise<void>`
  - `composePull(dir: string): Promise<void>`
  - `composeExec(dir: string, service: string, cmd: string[]): Promise<string>` — returns stdout
  - `composeLogs(dir: string, follow: boolean): Promise<void>` — inherits stdio

- [ ] **Step 1: Implement the wrapper**

Create `packages/cli/src/lib/docker.ts`:

```ts
import { spawn } from "node:child_process";

/** Run a command, capturing stdout. Rejects on non-zero exit. */
function run(cmd: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `${cmd} exited with code ${code}`));
    });
  });
}

/** Run a command inheriting the parent's stdio (for live logs). */
function runInherit(cmd: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", () => resolve());
  });
}

/** True if `docker compose` is usable on this machine. */
export async function dockerAvailable(): Promise<boolean> {
  try {
    await run("docker", ["compose", "version"]);
    return true;
  } catch {
    return false;
  }
}

export async function composeUp(dir: string): Promise<void> {
  await run("docker", ["compose", "up", "-d"], dir);
}

export async function composeDown(dir: string): Promise<void> {
  await run("docker", ["compose", "down"], dir);
}

export async function composePull(dir: string): Promise<void> {
  await run("docker", ["compose", "pull"], dir);
}

export async function composeExec(
  dir: string,
  service: string,
  cmd: string[],
): Promise<string> {
  return run("docker", ["compose", "exec", "-T", service, ...cmd], dir);
}

export async function composeLogs(dir: string, follow: boolean): Promise<void> {
  const args = ["compose", "logs"];
  if (follow) args.push("-f");
  await runInherit("docker", args, dir);
}
```

- [ ] **Step 2: Type-check + lint (no unit test — thin I/O wrapper, covered via mocks elsewhere)**

Run: `pnpm --filter @leconome/cli exec tsc --noEmit`
Expected: no errors.

Run: `pnpm exec biome check --write packages/cli/src/lib/docker.ts`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/lib/docker.ts
git commit -m "feat(cli): docker compose wrapper"
```

---

## Task 9: Peer id parsing + polling

**Files:**
- Create: `packages/cli/src/lib/peer.ts`, `packages/cli/src/lib/peer.test.ts`

**Interfaces:**
- Produces: `parsePeerId(stdout: string): string | null` — reads `ipfs-cluster-ctl --enc=json id` output.
- Produces: `pollPeerId(getStdout: () => Promise<string>, opts?: { attempts?: number; delayMs?: number }): Promise<string | null>`.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/lib/peer.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { parsePeerId, pollPeerId } from "./peer";

describe("parsePeerId", () => {
  it("reads the id field from cluster-ctl JSON", () => {
    expect(parsePeerId('{"id":"12D3KooWAbc","version":"1.0"}')).toBe("12D3KooWAbc");
  });

  it("returns null on empty or unparseable output", () => {
    expect(parsePeerId("")).toBeNull();
    expect(parsePeerId("connection refused")).toBeNull();
  });
});

describe("pollPeerId", () => {
  it("retries until an id appears", async () => {
    const getStdout = vi
      .fn()
      .mockResolvedValueOnce("") // daemon not ready
      .mockRejectedValueOnce(new Error("exec failed")) // container starting
      .mockResolvedValueOnce('{"id":"12D3KooWReady"}');
    const id = await pollPeerId(getStdout, { attempts: 5, delayMs: 0 });
    expect(id).toBe("12D3KooWReady");
    expect(getStdout).toHaveBeenCalledTimes(3);
  });

  it("returns null after exhausting attempts", async () => {
    const getStdout = vi.fn().mockResolvedValue("");
    const id = await pollPeerId(getStdout, { attempts: 3, delayMs: 0 });
    expect(id).toBeNull();
    expect(getStdout).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @leconome/cli exec vitest run src/lib/peer.test.ts`
Expected: FAIL — `Cannot find module './peer'`.

- [ ] **Step 3: Implement**

Create `packages/cli/src/lib/peer.ts`:

```ts
/** Parse a cluster peer id from `ipfs-cluster-ctl --enc=json id` stdout. */
export function parsePeerId(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout) as { id?: unknown };
    return typeof parsed.id === "string" && parsed.id.length > 0 ? parsed.id : null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll for the follower's cluster peer id until it appears or attempts run out.
 * `getStdout` is expected to run the cluster-ctl id command; failures (the
 * container still starting) are treated like "not ready yet".
 */
export async function pollPeerId(
  getStdout: () => Promise<string>,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<string | null> {
  const attempts = opts.attempts ?? 30;
  const delayMs = opts.delayMs ?? 2000;
  for (let i = 0; i < attempts; i++) {
    let id: string | null = null;
    try {
      id = parsePeerId(await getStdout());
    } catch {
      id = null;
    }
    if (id) return id;
    if (i < attempts - 1) await sleep(delayMs);
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @leconome/cli exec vitest run src/lib/peer.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/peer.ts packages/cli/src/lib/peer.test.ts
git commit -m "feat(cli): peer id parsing + polling"
```

---

## Task 10: `registerPeer`

**Files:**
- Create: `packages/cli/src/lib/register.ts`, `packages/cli/src/lib/register.test.ts`

**Interfaces:**
- Produces: `registerPeer(origin: string, token: string, peerId: string): Promise<void>` — POST `${origin}/join/${token}/register` `{ peerId }`; throws on non-OK.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/lib/register.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerPeer } from "./register";

afterEach(() => vi.restoreAllMocks());

describe("registerPeer", () => {
  it("POSTs the peer id to the register endpoint", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await registerPeer("https://host", "onb_x", "12D3KooWAbc");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://host/join/onb_x/register",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ peerId: "12D3KooWAbc" }),
      }),
    );
  });

  it("throws when the server rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: "no" }) })) as unknown as typeof fetch,
    );
    await expect(registerPeer("https://host", "onb_x", "p")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @leconome/cli exec vitest run src/lib/register.test.ts`
Expected: FAIL — `Cannot find module './register'`.

- [ ] **Step 3: Implement**

Create `packages/cli/src/lib/register.ts`:

```ts
/** Register the follower's cluster peer id with the dashboard (best-effort). */
export async function registerPeer(
  origin: string,
  token: string,
  peerId: string,
): Promise<void> {
  const res = await fetch(`${origin}/join/${token}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ peerId }),
  });
  if (!res.ok) {
    throw new Error(`registration failed (HTTP ${res.status})`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @leconome/cli exec vitest run src/lib/register.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/register.ts packages/cli/src/lib/register.test.ts
git commit -m "feat(cli): registerPeer"
```

---

## Task 11: `join` command orchestration

**Files:**
- Modify: `packages/cli/src/commands/join.ts`

**Interfaces:**
- Consumes: `parseJoinUrl` (T5), `fetchFollowerConfig` (T6), `projectDir`/`writeProject` (T7), `dockerAvailable`/`composeUp`/`composeExec` (T8), `pollPeerId` (T9), `registerPeer` (T10).
- Produces: `join(url?: string): Promise<void>`.

- [ ] **Step 1: Implement the orchestration with clack UX**

Replace `packages/cli/src/commands/join.ts`:

```ts
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join as pathJoin } from "node:path";
import * as p from "@clack/prompts";
import {
  composeExec,
  composeUp,
  dockerAvailable,
} from "../lib/docker.js";
import { fetchFollowerConfig } from "../lib/config.js";
import { parseJoinUrl } from "../lib/join-url.js";
import { pollPeerId } from "../lib/peer.js";
import { projectDir, writeProject } from "../lib/project.js";
import { registerPeer } from "../lib/register.js";

export async function join(url?: string): Promise<void> {
  p.intro("Econome follower");

  // 1. Resolve the join URL (prompt if not given).
  let joinUrl = url;
  if (!joinUrl) {
    const answer = await p.text({
      message: "Paste the join URL from the dashboard",
      placeholder: "https://your-dashboard/join/onb_…",
    });
    if (p.isCancel(answer)) {
      p.cancel("Cancelled.");
      return;
    }
    joinUrl = answer;
  }

  let origin: string;
  let token: string;
  try {
    ({ origin, token } = parseJoinUrl(joinUrl));
  } catch (err) {
    p.cancel(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  // 2. Preconditions.
  const dockerSpin = p.spinner();
  dockerSpin.start("Checking Docker");
  if (!(await dockerAvailable())) {
    dockerSpin.stop("Docker not found");
    p.cancel("Docker Compose is required. Install it: https://docs.docker.com/get-docker/");
    process.exitCode = 1;
    return;
  }
  dockerSpin.stop("Docker is ready");

  if (existsSync(pathJoin(homedir(), "econome-follower"))) {
    p.log.warn(
      "A bash-installed follower may already exist at ~/econome-follower. This CLI uses ~/.econome instead.",
    );
  }

  // 3. Fetch the rendered follower config.
  const cfgSpin = p.spinner();
  cfgSpin.start("Fetching cluster config");
  let config: Awaited<ReturnType<typeof fetchFollowerConfig>>;
  try {
    config = await fetchFollowerConfig(joinUrl);
  } catch (err) {
    cfgSpin.stop("Could not fetch config");
    p.cancel(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }
  cfgSpin.stop(`Joining "${config.clusterName}"`);

  // 4. Write the project + start the follower.
  const dir = projectDir();
  await writeProject(dir, config, { server: origin, token, clusterName: config.clusterName });

  const upSpin = p.spinner();
  upSpin.start("Starting follower (docker compose up)");
  try {
    await composeUp(dir);
  } catch (err) {
    upSpin.stop("Failed to start");
    p.cancel(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }
  upSpin.stop("Follower started");

  // 5. Wait for the cluster peer id, then register it (best-effort).
  const idSpin = p.spinner();
  idSpin.start("Waiting for the cluster peer to come online");
  const peerId = await pollPeerId(() =>
    composeExec(dir, "cluster", ["ipfs-cluster-ctl", "--enc=json", "id"]),
  );
  if (!peerId) {
    idSpin.stop("Peer not online yet");
    p.log.warn("The follower is running but hasn't reported a peer id yet. Check `econome logs`.");
    p.outro(`Replicating "${config.clusterName}". Manage with: econome status | logs | stop`);
    return;
  }
  idSpin.stop(`Peer online: ${peerId}`);

  const regSpin = p.spinner();
  regSpin.start("Registering with the dashboard");
  try {
    await registerPeer(origin, token, peerId);
    regSpin.stop("Registered");
  } catch {
    regSpin.stop("Could not register (the follower is still running)");
    p.log.warn("Registration failed; re-run `econome join` later to retry.");
  }

  p.outro(`Replicating "${config.clusterName}". Manage with: econome status | logs | stop`);
}
```

- [ ] **Step 2: Build to verify it compiles + wires the libs**

Run: `pnpm --filter @leconome/cli build`
Expected: builds with no type errors.

Run: `pnpm exec biome check --write packages/cli/src/commands/join.ts`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/commands/join.ts
git commit -m "feat(cli): join command orchestration"
```

---

## Task 12: `status`, `logs`, `stop`, `update` commands

**Files:**
- Modify: `packages/cli/src/commands/status.ts`, `logs.ts`, `stop.ts`, `update.ts`

**Interfaces:**
- Consumes: `projectDir`/`readProjectConfig` (T7), `composeExec`/`composeLogs`/`composeDown`/`composePull`/`composeUp` (T8), `parsePeerId` (T9).
- Produces: `status()`, `logs(follow)`, `stop()`, `update()`.

- [ ] **Step 1: Implement `status`**

Replace `packages/cli/src/commands/status.ts`:

```ts
import * as p from "@clack/prompts";
import { composeExec } from "../lib/docker.js";
import { parsePeerId } from "../lib/peer.js";
import { projectDir, readProjectConfig } from "../lib/project.js";

export async function status(): Promise<void> {
  const dir = projectDir();
  const cfg = await readProjectConfig(dir);
  if (!cfg) {
    p.log.error("No follower set up. Run `econome join <url>` first.");
    process.exitCode = 1;
    return;
  }

  p.intro(`Econome follower — ${cfg.clusterName}`);
  try {
    const idOut = await composeExec(dir, "cluster", ["ipfs-cluster-ctl", "--enc=json", "id"]);
    const peerId = parsePeerId(idOut);
    if (peerId) p.log.success(`Online — peer ${peerId}`);
    else p.log.warn("Cluster container is up but not reporting an id yet.");

    const pins = await composeExec(dir, "cluster", ["ipfs-cluster-ctl", "status"]);
    const pinCount = pins.split("\n").filter((l) => l.trim().length > 0).length;
    p.log.info(`Tracked pins: ${pinCount}`);
  } catch (err) {
    p.log.error(`Follower not reachable: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
  p.outro("Done");
}
```

- [ ] **Step 2: Implement `logs`**

Replace `packages/cli/src/commands/logs.ts`:

```ts
import * as p from "@clack/prompts";
import { composeLogs } from "../lib/docker.js";
import { projectDir, readProjectConfig } from "../lib/project.js";

export async function logs(follow: boolean): Promise<void> {
  const dir = projectDir();
  if (!(await readProjectConfig(dir))) {
    p.log.error("No follower set up. Run `econome join <url>` first.");
    process.exitCode = 1;
    return;
  }
  await composeLogs(dir, follow);
}
```

- [ ] **Step 3: Implement `stop`**

Replace `packages/cli/src/commands/stop.ts`:

```ts
import * as p from "@clack/prompts";
import { composeDown } from "../lib/docker.js";
import { projectDir, readProjectConfig } from "../lib/project.js";

export async function stop(): Promise<void> {
  const dir = projectDir();
  if (!(await readProjectConfig(dir))) {
    p.log.error("No follower set up. Run `econome join <url>` first.");
    process.exitCode = 1;
    return;
  }
  const s = p.spinner();
  s.start("Stopping follower");
  await composeDown(dir);
  s.stop("Stopped (data kept). Re-start with `econome update` or `econome join`.");
}
```

- [ ] **Step 4: Implement `update`**

Replace `packages/cli/src/commands/update.ts`:

```ts
import * as p from "@clack/prompts";
import { composePull, composeUp } from "../lib/docker.js";
import { projectDir, readProjectConfig } from "../lib/project.js";

export async function update(): Promise<void> {
  const dir = projectDir();
  if (!(await readProjectConfig(dir))) {
    p.log.error("No follower set up. Run `econome join <url>` first.");
    process.exitCode = 1;
    return;
  }
  const s = p.spinner();
  s.start("Pulling newer images");
  await composePull(dir);
  s.message("Restarting");
  await composeUp(dir);
  s.stop("Updated and restarted.");
}
```

- [ ] **Step 5: Build, lint, full test run**

Run: `pnpm --filter @leconome/cli build`
Expected: builds clean.

Run: `pnpm --filter @leconome/cli test`
Expected: all CLI unit tests pass.

Run: `pnpm exec biome check --write packages/cli/src/commands`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/status.ts packages/cli/src/commands/logs.ts packages/cli/src/commands/stop.ts packages/cli/src/commands/update.ts
git commit -m "feat(cli): status, logs, stop, update commands"
```

---

## Task 13: Full verification + manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Whole-repo checks**

Run: `pnpm install`
Expected: lockfile consistent.

Run: `pnpm --filter web test && pnpm --filter @leconome/cli test`
Expected: all tests pass.

Run: `pnpm --filter web exec tsc --noEmit && pnpm --filter @leconome/cli exec tsc --noEmit`
Expected: no type errors.

Run: `pnpm exec biome check apps/web packages/cli`
Expected: clean.

Run: `pnpm build --filter=@leconome/payload-storage-ipfs --filter=@leconome/cli`
Expected: both publishable packages build (mirrors the CI publish step).

- [ ] **Step 2: Manual smoke test (documented; requires a live dashboard with CLUSTER_BOOTSTRAP set + Docker)**

```bash
# Mint a token on the dashboard Onboarding page, copy its npx command, then:
node packages/cli/dist/index.js join https://<dashboard>/join/<token>
# Expect: docker images pull, follower starts, peer id printed, "Registered".
node packages/cli/dist/index.js status   # Online + pin count
node packages/cli/dist/index.js logs      # cluster + kubo logs
node packages/cli/dist/index.js stop      # stops, keeps data
```
On the dashboard, the token's badge should now read **joined** with the peer id.

- [ ] **Step 3: Final commit (if any doc tweaks)**

```bash
git add -A
git commit -m "chore: verify @leconome/cli end-to-end" || echo "nothing to commit"
```

---

## Self-Review Notes

- **Spec coverage:** distribution (T4 npx scaffold), full lifecycle commands (T11–T12), peer registration (T3 route + T10 client + T11 wiring), content-negotiated config delivery (T1–T2), onboarding npx command (T2), dual-directory warning (T11), testing strategy (TDD on pure logic T1/T5–T10; thin docker wrapper T8 untested by design but mock-covered via consumers; manual smoke T13). All covered.
- **Out of scope** items from the spec (binary distribution, Windows-native, CLI self-update, token single-use) are intentionally omitted.
- **Type consistency:** `FollowerConfig` (T6) is consumed by T7/T11; `ProjectConfig` (T7) by T11/T12; docker wrapper names (`composeUp`/`composeExec`/`composeDown`/`composePull`/`composeLogs`/`dockerAvailable`) are used consistently in T11–T12; `parsePeerId`/`pollPeerId` (T9) in T11/T12.
