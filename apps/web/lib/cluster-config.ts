import "server-only";

/**
 * Static cluster identity used to build participant onboarding bundles.
 * Sourced from env so the same dashboard image works across environments.
 */
export interface FollowerBundle {
  clusterName: string;
  secret: string;
  bootstrapMultiaddr: string;
  /** One-line command a participant runs to join as a follower. */
  command: string;
}

export function buildFollowerBundle(): FollowerBundle {
  const clusterName = process.env.CLUSTER_NAME ?? "econome";
  const secret = process.env.CLUSTER_SECRET ?? "";
  const bootstrapMultiaddr = process.env.CLUSTER_BOOTSTRAP ?? "";

  const command = [
    `CLUSTER_SECRET=${secret || "<cluster-secret>"}`,
    `ipfs-cluster-follow ${clusterName}`,
    `run --init ${bootstrapMultiaddr || "<bootstrap-multiaddr>"}`,
  ].join(" ");

  return { clusterName, secret, bootstrapMultiaddr, command };
}

/** Public base URL of the dashboard, used to build join one-liners. */
export function appBaseUrl(): string {
  const url =
    process.env.APP_URL ??
    process.env.BETTER_AUTH_URL ??
    "http://localhost:3000";
  return url.replace(/\/$/, "");
}

/** The `curl … | bash` one-liner a participant runs for a given token. */
export function joinCommand(token: string): string {
  return `curl -fsSL ${appBaseUrl()}/join/${token} | bash`;
}

/** Single-quote a value for safe interpolation into the generated bash. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Build the Docker-based join script served at `/join/[token]`. It writes a
 * self-contained compose project (Kubo + ipfs-cluster) wired to this cluster's
 * secret and bootstrap peer, mirroring the `--profile follower` services, and
 * starts it. Requires only Docker on the participant's machine.
 */
export function buildDockerJoinScript(bundle: FollowerBundle): string {
  const { clusterName, secret, bootstrapMultiaddr } = bundle;
  // Trust only the main peer (the peer id embedded in the bootstrap multiaddr)
  // so a follower replicates read-only rather than trusting every CRDT peer.
  const mainPeerId = bootstrapMultiaddr.split("/p2p/")[1] ?? "";
  const trustedPeers = mainPeerId || "*";

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
#!/bin/sh
set -e
ipfs config Addresses.API /ip4/0.0.0.0/tcp/5001
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["*"]'
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '["PUT","POST","GET"]'
KUBO_EOF

cat > docker-compose.yml <<'COMPOSE_EOF'
services:
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
COMPOSE_EOF

echo "==> Starting follower in $DIR"
$COMPOSE up -d

echo ""
echo "Done. This node is now replicating the $CLUSTER_NAME pinset."
echo "  Logs:  (cd $DIR && $COMPOSE logs -f cluster)"
echo "  Stop:  (cd $DIR && $COMPOSE down)"
`;
}
