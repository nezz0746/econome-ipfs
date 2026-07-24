import { parseTags } from "@/lib/tags";

/** How multiple selected tags combine. */
export type TagMode = "any" | "all";

export interface FileFilters {
  /** Case-insensitive substring matched against the file name. */
  q: string;
  tags: string[];
  mode: TagMode;
}

/**
 * Next delivers repeated query keys (?q=a&q=b) as arrays; take the first
 * usable value. Anything that isn't a string (missing, array of non-strings,
 * empty array) coerces to "" rather than throwing.
 */
export function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
  return typeof value === "string" ? value : "";
}

/**
 * Parse the Files page query params into a filter state. Invalid input is
 * coerced to "no filter" rather than throwing: a hand-edited URL should show
 * unfiltered files, not an error page.
 */
export function parseFileFilters(params: {
  q?: string | string[];
  tags?: string | string[];
  mode?: string | string[];
}): FileFilters {
  return {
    q: firstParam(params.q).trim(),
    // parseTags returns null when any entry is not a valid slug.
    tags: parseTags(params.tags) ?? [],
    mode: firstParam(params.mode) === "all" ? "all" : "any",
  };
}

/**
 * Escape LIKE/ILIKE wildcards so user input matches literally. Pair with an
 * explicit `ESCAPE '\'` clause in the query. Backslash first, or it would
 * double-escape the escapes added after it.
 */
export function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/[%_]/g, (ch) => `\\${ch}`);
}

/** True when the filters actually narrow the result set (mode alone does not). */
export function hasActiveFilters(filters: FileFilters): boolean {
  return filters.q !== "" || filters.tags.length > 0;
}

/** Files page URL preserving every filter plus pagination. */
export function filesHref(
  filters: FileFilters,
  page: number,
  pageSize: number,
): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.tags.length > 0) params.set("tags", filters.tags.join(","));
  if (filters.mode === "all") params.set("mode", "all");
  if (page > 1) params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return `/dashboard/files?${params.toString()}`;
}
