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
  const [first, token] = parts;
  if (first !== "join" || !token) {
    throw new Error(`"${input}" is not a join URL (expected …/join/<token>).`);
  }
  return { origin: url.origin, token };
}
