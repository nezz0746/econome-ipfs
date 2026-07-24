import type { Sort } from "@/lib/table-sort";
import { parseTags } from "@/lib/tags";

/** How multiple selected tags combine. */
export type TagMode = "any" | "all";

/** Columns the Files table can be ordered by. */
export type FileSortKey = "name" | "size" | "createdAt";
export const FILE_SORT_KEYS: readonly FileSortKey[] = [
  "name",
  "size",
  "createdAt",
] as const;
/** Newest first — the historical default, unchanged. */
export const DEFAULT_FILE_SORT: Sort<FileSortKey> = {
  key: "createdAt",
  dir: "desc",
};

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

/** Files page URL preserving every filter, the sort, and pagination. */
export function filesHref(
  filters: FileFilters,
  sort: Sort<FileSortKey>,
  page: number,
  pageSize: number,
): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.tags.length > 0) params.set("tags", filters.tags.join(","));
  if (filters.mode === "all") params.set("mode", "all");
  // Omit the default ordering so a clean view keeps a clean URL.
  if (
    sort.key !== DEFAULT_FILE_SORT.key ||
    sort.dir !== DEFAULT_FILE_SORT.dir
  ) {
    params.set("sort", sort.key);
    params.set("dir", sort.dir);
  }
  if (page > 1) params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return `/dashboard/files?${params.toString()}`;
}
