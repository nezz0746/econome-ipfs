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
