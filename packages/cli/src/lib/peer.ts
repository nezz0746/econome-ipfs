/** Parse a cluster peer id from `ipfs-cluster-ctl --enc=json id` stdout. */
export function parsePeerId(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout) as { id?: unknown };
    return typeof parsed.id === "string" && parsed.id.length > 0
      ? parsed.id
      : null;
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
