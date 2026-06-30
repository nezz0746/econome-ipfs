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

/** The `npx @leconome/cli join …` one-liner for a given token. */
export function npxJoinCommand(token: string): string {
  return `npx -y @leconome/cli join ${appBaseUrl()}/join/${token}`;
}
