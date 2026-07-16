/**
 * Register the follower's cluster peer id with the dashboard (best-effort).
 * `tags` are the replication tags to subscribe to; omit to use the defaults
 * the operator set on the onboarding token.
 */
export async function registerPeer(
  origin: string,
  token: string,
  peerId: string,
  tags?: string[],
): Promise<void> {
  const res = await fetch(`${origin}/join/${token}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(tags ? { peerId, tags } : { peerId }),
  });
  if (!res.ok) {
    throw new Error(`registration failed (HTTP ${res.status})`);
  }
}
