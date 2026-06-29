# Deployment (Dokploy)

This guide deploys the whole stack — Postgres, Kubo, IPFS Cluster, the Hono API,
and the Next dashboard — to [Dokploy](https://dokploy.com) using
`docker-compose.prod.yml`.

## What gets deployed

| Service | Image / build | Purpose | Public? |
| --- | --- | --- | --- |
| `web` | `apps/web/Dockerfile` | Next dashboard | Yes — your primary domain → port `3000` |
| `api` | `apps/api/Dockerfile` | Hono ingest + cluster gateway | Optional domain → port `8080` (needed only if machine clients ingest from outside) |
| `cluster` | `ipfs/ipfs-cluster` | Trusted cluster peer | Swarm `9096` published for participant followers |
| `kubo` | `ipfs/kubo` | IPFS daemon | Swarm `4001` published for P2P |
| `postgres` | `postgres:16-alpine` | Auth + accounting + uploads | No |

Persistence uses named Docker volumes: `pg-data`, `ipfs-data`, `cluster-data`.

## 1. Prerequisites

- A server running Dokploy, with a domain pointed at it.
- This repository on GitHub (Dokploy deploys from Git).

## 2. Generate secrets

Run locally and keep these safe — you'll paste them into Dokploy:

```bash
openssl rand -hex 32   # CLUSTER_SECRET
openssl rand -hex 32   # BETTER_AUTH_SECRET
openssl rand -hex 32   # ENCRYPTION_KEY
openssl rand -hex 24   # INTERNAL_TOKEN
openssl rand -hex 16   # POSTGRES_PASSWORD
```

> `ENCRYPTION_KEY` encrypts API keys at rest. If you ever change it, existing
> stored keys become unreadable and must be rotated. `CLUSTER_SECRET` must be
> the same value every participant uses to join.

## 3. Create the Dokploy project

1. In Dokploy: **Create Project → Compose**.
2. **Source**: connect this GitHub repo, branch `main`.
3. **Compose Path**: `docker-compose.prod.yml`.
4. **Environment**: paste the variables below (Dokploy injects them into the
   compose interpolation).

```dotenv
# Postgres
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<from step 2>
POSTGRES_DB=econome
DATABASE_URL=postgres://postgres:<POSTGRES_PASSWORD>@postgres:5432/econome

# Cluster
CLUSTER_SECRET=<from step 2>
# Lock this down in production: set to the main peer ID instead of "*"
CLUSTER_TRUSTED_PEERS=*

# API
INTERNAL_TOKEN=<from step 2>
REPLICATION_MIN=-1
REPLICATION_MAX=-1
ACCOUNTING_INTERVAL_MS=60000

# Dashboard
BETTER_AUTH_SECRET=<from step 2>
BETTER_AUTH_URL=https://<your-dashboard-domain>
ENCRYPTION_KEY=<from step 2>
IPFS_GATEWAY_URL=https://<your-gateway-domain-or-public-gateway>
CLUSTER_NAME=econome
# Public multiaddr participants bootstrap against (fill in after first deploy):
CLUSTER_BOOTSTRAP=/dns4/<your-host>/tcp/9096/p2p/<MAIN_PEER_ID>
```

## 4. Domains

In the Compose service's **Domains** tab:

- Add your primary domain → service **`web`**, port **`3000`** (enable HTTPS).
  Make sure `BETTER_AUTH_URL` matches this exact URL.
- (Optional) Add a domain → service **`api`**, port **`8080`** if external
  machine clients will call `POST /ingest`. The dashboard itself reaches the API
  internally, so this isn't required.

Ports `4001` (kubo) and `9096` (cluster) are published at the host level for
libp2p — make sure your server firewall allows them so participants can connect.

## 5. Deploy

Click **Deploy**. Dokploy builds the `web` and `api` images and starts all five
services. The API runs database migrations automatically on startup (retrying
until Postgres is ready).

## 6. First-run setup

1. Open your dashboard domain and create the first admin account on `/login`
   (open signup — see the hardening note below).
2. Go to **API Keys** → create a key for any machine clients that will ingest.
3. Find the **main cluster peer ID** (Peers page, or
   `docker logs <cluster-container>`), then set `CLUSTER_BOOTSTRAP` and redeploy
   so the onboarding bundle shows the correct join command.
4. Share the onboarding bundle (Onboarding page) with participants. They run:
   ```bash
   CLUSTER_SECRET=<secret> ipfs-cluster-follow econome run --init <bootstrap>
   ```

## Hardening for production

- **Close open signup.** v1 enables email/password self-registration. After
  creating your admins, disable it in `apps/web/lib/auth.ts`
  (`emailAndPassword.disableSignUp: true`) and redeploy, or front the dashboard
  with an allowlist.
- **Trust model.** Set `CLUSTER_TRUSTED_PEERS` to your main peer ID(s) instead
  of `*` so participant followers replicate read-only and can't modify the
  pinset.
- **Backups.** Snapshot the `pg-data` and `cluster-data` volumes.

## Updating

Push to `main` and click **Redeploy** in Dokploy (or enable auto-deploy on push).
Migrations apply automatically on the API's next boot.

## Alternative: separate applications

Instead of one Compose service you can deploy `web` and `api` as two Dokploy
**Applications** (each pointing at its `Dockerfile`), a Dokploy-managed
**Postgres** database, and Kubo/Cluster as their own services. The Compose
approach above is simpler and keeps everything versioned in one file.
