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
