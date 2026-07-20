# OpenAPI Docs for the Machine API

**Date:** 2026-07-20
**Status:** Approved

## Goal

Self-serve API documentation for the machine (API-key) surface of the storage
center: a generated OpenAPI 3.1 spec plus an interactive reference UI, linked
from the dashboard. External integrators (Payload adapter users, scripts,
future participants) can discover and try the API without reading source.

## Decisions (locked)

| Question | Decision |
|---|---|
| Scope | Machine API only: `/ingest*` and `/folders*`. The `/cluster/*` internal gateway is NOT documented (private BFF contract). |
| Generation | `hono-openapi` route decorations + zod schemas — spec generated at runtime from code; existing handlers and manual validation stay untouched. |
| UI | Scalar (`@scalar/hono-api-reference`) at `GET /docs`; spec at `GET /openapi.json`. |
| Exposure | Public: `/docs` and `/openapi.json` are unauthenticated (the spec documents the `x-api-key` scheme, never keys). |
| Dashboard | "API Docs" links in the web app, via a new `API_PUBLIC_URL` env var. |
| Out of scope | Replacing manual request validation with the zod schemas (possible later, deliberately not now); documenting `/cluster/*`; auth-gating docs. |

## Architecture

### API (`apps/api`)

- New deps: `hono-openapi`, `zod`, `@scalar/hono-api-reference`.
  ⚠️ `hono-openapi`'s resolver API has changed across versions — the
  implementation plan pins exact versions and verifies the current
  zod-resolver wiring against the package docs before writing decorations.
- New file `apps/api/src/openapi.ts` — the single docs-owning module:
  - zod schemas for every machine route's request/response: ingest
    (multipart file+tags → `{cid,name,size,tags}`), pin (`{cids,tags}` →
    per-CID results), import (`{cids,gateway?,tags}`), record
    (`{files:[{cid,size,name?}]}`), unpin-by-CID; folder create/list/get,
    multipart folder upload (repeated `file`+`path`, `?commit`), cids-mount,
    move, remove-path, tags patch, folder delete. Plus the shared
    `{error: string}` error schema.
  - the `x-api-key` (header) security scheme, applied to all documented
    routes.
  - `mountDocs(app)`: registers `GET /openapi.json` (generated spec — title
    "Econome Storage API", version from the api package.json) and
    `GET /docs` (Scalar pointing at `/openapi.json`).
- `apps/api/src/app.ts` + `apps/api/src/folder-routes.ts`: each machine
  route gains a `describeRoute({...})` decoration (summary, request/response
  schemas, tags "ingest" / "folders"). **Handler bodies and validation are
  not modified.**
- Mounting rules:
  - `mountDocs` runs before/outside the auth middlewares → public.
  - Folder routes are documented once, as `/folders/*` with `x-api-key`
    auth; the `/cluster/folders` internal mount stays out of the spec (the
    spec generator is configured to exclude `/cluster/*`).

### Web (`apps/web`)

- New env var `API_PUBLIC_URL` (server-side, default
  `http://localhost:8080`): the browser-reachable base URL of the API.
  `HONO_URL` cannot be reused — in prod it is the internal
  `http://api:8080`.
- Dashboard overview page: an "API Docs" link/card pointing at
  `${API_PUBLIC_URL}/docs` (opens in a new tab).
- API Keys page: the same link next to the key list ("Read the API docs"),
  where integrators are when they need it.
- Compose: `docker-compose.yml` web service gets
  `API_PUBLIC_URL: ${API_PUBLIC_URL:-http://localhost:8080}`;
  `docker-compose.prod.yml` web service gets
  `API_PUBLIC_URL: ${API_PUBLIC_URL:-}` (empty until the operator attaches a
  public API domain). When the value is empty, the dashboard renders no docs
  links — never a broken link.

## Error handling

None beyond existing behavior — spec generation is static metadata; a broken
schema fails at boot (caught by tests), not per-request.

## Testing

Additions to `apps/api/test/app.test.ts`:
- `GET /openapi.json` → 200, `openapi` version `3.1.x`, `paths` contain
  `/ingest` and `/folders`, security schemes contain the apiKey header, and
  NO path starts with `/cluster`.
- `GET /docs` → 200 HTML.
- Both succeed without any auth header.
- The full existing suite (146 api tests) stays green — proves handlers and
  validation were not touched.

Web: gates only (`check-types`, biome, build) — consistent with other
dashboard pages.

## Success criteria

An integrator with no repo access can open `${API_PUBLIC_URL}/docs` from the
dashboard link, read every machine endpoint with schemas and auth
requirements, and issue a test request with their API key from Scalar's
request tester.
