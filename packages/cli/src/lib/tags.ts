const TAG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * Parse a comma-separated tag list (mirrors the server's rules: lowercase
 * slugs, trimmed, deduped). Returns `[]` for empty input, `null` when an
 * entry is not a valid tag.
 */
export function parseTagsInput(input: string): string[] | null {
  const tags: string[] = [];
  for (const entry of input.split(",")) {
    const tag = entry.trim().toLowerCase();
    if (tag === "") continue;
    if (!TAG_RE.test(tag)) return null;
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}
