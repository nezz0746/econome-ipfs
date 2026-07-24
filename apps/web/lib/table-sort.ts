import { firstParam } from "@/lib/file-filters";

export type SortDir = "asc" | "desc";

export interface Sort<K extends string> {
  key: K;
  dir: SortDir;
}

/**
 * Parse sort params against an allow-list. An unknown key falls back whole
 * (key AND direction) — a hand-edited URL should show the default ordering,
 * never an error page.
 */
export function parseSort<K extends string>(
  params: { sort?: string | string[]; dir?: string | string[] },
  allowed: readonly K[],
  fallback: Sort<K>,
): Sort<K> {
  const rawKey = firstParam(params.sort);
  const key = allowed.find((k) => k === rawKey);
  if (!key) return fallback;

  const rawDir = firstParam(params.dir);
  const dir: SortDir =
    rawDir === "asc" || rawDir === "desc" ? rawDir : fallback.dir;
  return { key, dir };
}

/**
 * Direction a header click should produce: clicking the active column flips
 * it, clicking a different column starts at that column's natural default
 * (names read best A–Z, sizes and dates biggest/newest first).
 */
export function nextDir<K extends string>(
  current: Sort<K>,
  key: K,
  defaultDir: SortDir,
): SortDir {
  if (current.key !== key) return defaultDir;
  return current.dir === "asc" ? "desc" : "asc";
}

export type FolderSortKey = "name" | "size";

/**
 * Sort folders in memory (the API returns the whole list — there is no
 * pagination). Returns a new array; the input is left untouched.
 */
export function sortFolders<T extends { name: string; size: number }>(
  folders: readonly T[],
  sort: Sort<FolderSortKey>,
): T[] {
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...folders].sort((a, b) => {
    const delta =
      sort.key === "size"
        ? a.size - b.size
        : // Locale-aware so accented names (Élan) sort with their base letter
          // rather than after Z as raw code points would put them.
          a.name.localeCompare(b.name);
    return delta * factor;
  });
}
