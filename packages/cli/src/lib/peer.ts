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

/**
 * Count tracked pins from `ipfs-cluster-ctl --enc=json status` stdout.
 *
 * cluster-ctl does not emit a single JSON array: it prints one pretty-printed
 * JSON object per CID, concatenated back to back. (Other versions/commands may
 * emit an array or newline-delimited objects.) So we count top-level JSON
 * objects by scanning brace depth outside of strings, which is robust to all
 * three shapes. Returns 0 on empty output (e.g. the container still starting).
 */
export function parsePinCount(stdout: string): number {
  const text = stdout.trim();
  if (!text) return 0;

  // Fast path: a single JSON value. An array yields its length; a lone object
  // is one pin. Concatenated/newline-delimited objects fail here (more than one
  // top-level value) and fall through to the scanner below.
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.length;
    if (parsed && typeof parsed === "object") return 1;
    return 0;
  } catch {
    // Not a single JSON value — count a stream of objects.
  }

  // Count each top-level `{`, ignoring braces inside string literals.
  let depth = 0;
  let count = 0;
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (escaped) {
      escaped = false;
    } else if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      if (depth === 0) count++;
      depth++;
    } else if (ch === "}" && depth > 0) {
      depth--;
    }
  }
  return count;
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
