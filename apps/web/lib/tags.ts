const TAG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * Normalize a replication-tag list from user input: a comma-separated string
 * or an array of strings. Tags are trimmed, lowercased and deduped (same
 * rules as the API). Returns `[]` for absent/empty input, `null` when any
 * entry is not a valid tag slug.
 */
export function parseTags(input: unknown): string[] | null {
  if (input === undefined || input === null || input === "") return [];
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : null;
  if (raw === null) return null;

  const tags: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") return null;
    const tag = entry.trim().toLowerCase();
    if (tag === "") continue;
    if (!TAG_RE.test(tag)) return null;
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}
