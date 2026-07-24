# Sortable Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clickable column headers that sort the Files table (Name/Size/Added, in SQL, across the whole filtered set) and the Folders table (Name/Size, in memory).

**Architecture:** A pure `lib/table-sort.ts` owns sort-param parsing, click-direction logic and the folder comparator. A server-component `SortableHeader` renders each header as a plain link — no client JS, because the href is computed server-side and filters already live in the URL. The Files page adds `sort`/`dir` to its query params and its `ORDER BY`; the Folders page gains `searchParams` and sorts its array.

**Tech Stack:** Next.js App Router server components, Drizzle ORM (postgres-js), vitest, shadcn/ui Table, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-07-21-sortable-columns-design.md`

## Global Constraints

- Branch: `feat/sort-by-name` (off `main`; already created — work on it).
- Files sortable keys: `name`, `size`, `createdAt`. Default `{ key: "createdAt", dir: "desc" }` — **unchanged behaviour**.
- Folders sortable keys: `name`, `size`. Default `{ key: "name", dir: "asc" }`.
- First-click direction per column: Name → `asc`; Size → `desc`; Added → `desc`. Clicking the already-active column flips it.
- **Any sort change resets to page 1.**
- **A non-default sort is NOT an active filter** — `hasActiveFilters` must stay untouched, so sorting never lights up Clear or the "no files match these filters" empty state.
- Files `ORDER BY` must pin `NULLS LAST` in **both** directions for the nullable `name`, and **every** ordering must end with `uploads.id` as a stable tiebreaker (OFFSET pagination duplicates/skips rows on ties otherwise).
- Invalid/unknown `sort` or `dir` falls back to the default — a hand-edited URL must never error the page.
- Reuse the existing `firstParam` helper from `apps/web/lib/file-filters.ts` for array-valued query params.
- TypeScript strict + `noUncheckedIndexedAccess`. Web tests live in `apps/web/lib/**/*.test.ts` (see `apps/web/vitest.config.ts`); no page unit tests (repo convention).
- Gates per commit: `pnpm exec biome check --write apps/web`, `pnpm --filter web check-types`, `pnpm --filter web test`. Node ≥ 22 (`export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22`).
- Every commit message ends with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `lib/table-sort.ts` — pure sort module (TDD)

**Files:**
- Create: `apps/web/lib/table-sort.ts`
- Test: `apps/web/lib/table-sort.test.ts`

**Interfaces:**
- Consumes: `firstParam(value: string | string[] | undefined): string` from `apps/web/lib/file-filters.ts` (returns the first string of a repeated param, `""` for anything non-string).
- Produces (used by Tasks 2–4):
  ```ts
  export type SortDir = "asc" | "desc";
  export interface Sort<K extends string> { key: K; dir: SortDir }
  export function parseSort<K extends string>(
    params: { sort?: string | string[]; dir?: string | string[] },
    allowed: readonly K[],
    fallback: Sort<K>,
  ): Sort<K>
  export function nextDir<K extends string>(current: Sort<K>, key: K, defaultDir: SortDir): SortDir
  export type FolderSortKey = "name" | "size";
  export function sortFolders<T extends { name: string; size: number }>(
    folders: readonly T[],
    sort: Sort<FolderSortKey>,
  ): T[]
  ```

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/table-sort.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  type FolderSortKey,
  nextDir,
  parseSort,
  type Sort,
  sortFolders,
} from "./table-sort";

const FILE_KEYS = ["name", "size", "createdAt"] as const;
type FileKey = (typeof FILE_KEYS)[number];
const FILE_FALLBACK: Sort<FileKey> = { key: "createdAt", dir: "desc" };

describe("parseSort", () => {
  it("returns the fallback when no params are present", () => {
    expect(parseSort({}, FILE_KEYS, FILE_FALLBACK)).toEqual(FILE_FALLBACK);
  });

  it("accepts an allowed key with an explicit direction", () => {
    expect(parseSort({ sort: "name", dir: "asc" }, FILE_KEYS, FILE_FALLBACK)).toEqual(
      { key: "name", dir: "asc" },
    );
  });

  it("falls back entirely when the key is not allowed", () => {
    // An unknown key must not keep a user-supplied direction either.
    expect(parseSort({ sort: "cid", dir: "asc" }, FILE_KEYS, FILE_FALLBACK)).toEqual(
      FILE_FALLBACK,
    );
  });

  it("falls back to the fallback direction when dir is invalid", () => {
    expect(parseSort({ sort: "size", dir: "sideways" }, FILE_KEYS, FILE_FALLBACK)).toEqual(
      { key: "size", dir: "desc" },
    );
  });

  it("takes the first value of repeated params", () => {
    expect(
      parseSort({ sort: ["name", "size"], dir: ["asc", "desc"] }, FILE_KEYS, FILE_FALLBACK),
    ).toEqual({ key: "name", dir: "asc" });
  });

  it("never throws on junk input", () => {
    expect(() => parseSort({ sort: [], dir: [] }, FILE_KEYS, FILE_FALLBACK)).not.toThrow();
    expect(parseSort({ sort: [], dir: [] }, FILE_KEYS, FILE_FALLBACK)).toEqual(FILE_FALLBACK);
  });
});

describe("nextDir", () => {
  it("flips the direction when clicking the active column", () => {
    expect(nextDir({ key: "name", dir: "asc" }, "name", "asc")).toBe("desc");
    expect(nextDir({ key: "name", dir: "desc" }, "name", "asc")).toBe("asc");
  });

  it("uses the column's natural default when switching columns", () => {
    // Current direction of the OTHER column must not leak in.
    expect(nextDir({ key: "name", dir: "desc" }, "size", "desc")).toBe("desc");
    expect(nextDir({ key: "size", dir: "asc" }, "name", "asc")).toBe("asc");
  });
});

describe("sortFolders", () => {
  const folders = [
    { name: "zebra", size: 10 },
    { name: "Élan", size: 300 },
    { name: "apple", size: 200 },
  ];

  const by = (sort: Sort<FolderSortKey>) =>
    sortFolders(folders, sort).map((f) => f.name);

  it("sorts by name ascending using locale rules", () => {
    // localeCompare puts É with E, not after Z as raw code points would.
    expect(by({ key: "name", dir: "asc" })).toEqual(["apple", "Élan", "zebra"]);
  });

  it("sorts by name descending", () => {
    expect(by({ key: "name", dir: "desc" })).toEqual(["zebra", "Élan", "apple"]);
  });

  it("sorts by size", () => {
    expect(by({ key: "size", dir: "desc" })).toEqual(["Élan", "apple", "zebra"]);
    expect(by({ key: "size", dir: "asc" })).toEqual(["zebra", "apple", "Élan"]);
  });

  it("does not mutate the input array", () => {
    const input = [{ name: "b", size: 1 }, { name: "a", size: 2 }];
    sortFolders(input, { key: "name", dir: "asc" });
    expect(input.map((f) => f.name)).toEqual(["b", "a"]);
  });

  it("keeps equal values in their original order", () => {
    const ties = [
      { name: "first", size: 5 },
      { name: "second", size: 5 },
    ];
    expect(sortFolders(ties, { key: "size", dir: "asc" }).map((f) => f.name)).toEqual([
      "first",
      "second",
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
pnpm --filter web test -- table-sort
```

Expected: FAIL — `Cannot find module './table-sort'`

- [ ] **Step 3: Implement `apps/web/lib/table-sort.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter web test -- table-sort
pnpm --filter web test
```

Expected: the new suite passes and the 29 pre-existing tests stay green.

- [ ] **Step 5: Gates + commit**

```bash
pnpm exec biome check --write apps/web
pnpm --filter web check-types
git add apps/web/lib/table-sort.ts apps/web/lib/table-sort.test.ts
git commit -m "feat(web): sort param parsing, click-direction logic and folder comparator"
```

---

### Task 2: `SortableHeader` server component

**Files:**
- Create: `apps/web/components/sortable-header.tsx`

**Interfaces:**
- Consumes: `SortDir` from `@/lib/table-sort`; `TableHead` from `@/components/ui/table`; `ArrowDown`, `ArrowUp`, `ArrowUpDown` from `lucide-react`.
- Produces (used by Tasks 3–4):
  ```ts
  export function SortableHeader(props: {
    label: string;
    href: string;
    active: boolean;
    dir: SortDir;
    align?: "left" | "right";
  }): JSX.Element
  ```
  Renders a `<TableHead>` containing a link. **No `"use client"`** — it is a
  plain link, so it stays a server component.

- [ ] **Step 1: Create `apps/web/components/sortable-header.tsx`**

```tsx
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { TableHead } from "@/components/ui/table";
import type { SortDir } from "@/lib/table-sort";

/**
 * A column header that sorts by navigation. The href is built server-side
 * from the current URL state, so this needs no client JS: filters and page
 * size ride along in the query string.
 */
export function SortableHeader({
  label,
  href,
  active,
  dir,
  align = "left",
}: {
  label: string;
  href: string;
  active: boolean;
  dir: SortDir;
  align?: "left" | "right";
}) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead
      aria-sort={
        active ? (dir === "asc" ? "ascending" : "descending") : "none"
      }
      className={align === "right" ? "text-right" : undefined}
    >
      <a
        href={href}
        className={`inline-flex items-center gap-1 hover:text-foreground ${
          active ? "text-foreground" : ""
        }`}
      >
        <span>{label}</span>
        <Icon
          className={`size-3.5 ${active ? "" : "text-muted-foreground/50"}`}
          aria-hidden="true"
        />
      </a>
    </TableHead>
  );
}
```

- [ ] **Step 2: Gates**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
pnpm exec biome check --write apps/web
pnpm --filter web check-types
```

Expected: both clean. (No unit test — it is presentational markup; the repo has no page/component tests. It is exercised by the build in Tasks 3–4.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/sortable-header.tsx
git commit -m "feat(web): SortableHeader link-based column header"
```

---

### Task 3: Files page sorting (SQL)

**Files:**
- Modify: `apps/web/lib/file-filters.ts` (extend `filesHref`)
- Modify: `apps/web/components/files-filters.tsx` (accept + preserve sort)
- Modify: `apps/web/app/dashboard/files/page.tsx`
- Test: `apps/web/lib/file-filters.test.ts` (append)

**Interfaces:**
- Consumes: `Sort`, `SortDir`, `parseSort`, `nextDir` (Task 1); `SortableHeader` (Task 2); existing `FileFilters`, `firstParam`, `parseFileFilters`, `escapeLike`, `hasActiveFilters`.
- Produces:
  ```ts
  // lib/file-filters.ts — filesHref gains a sort argument (4th position is page)
  export type FileSortKey = "name" | "size" | "createdAt";
  export const FILE_SORT_KEYS: readonly FileSortKey[];
  export const DEFAULT_FILE_SORT: Sort<FileSortKey>;   // { key: "createdAt", dir: "desc" }
  export function filesHref(
    filters: FileFilters,
    sort: Sort<FileSortKey>,
    page: number,
    pageSize: number,
  ): string
  ```

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/lib/file-filters.test.ts` (add `DEFAULT_FILE_SORT` and `type FileSortKey` to the existing import from `./file-filters`, and `import type { Sort } from "./table-sort";`):

```ts
describe("filesHref with sort", () => {
  const clean: FileFilters = { q: "", tags: [], mode: "any" };

  it("omits sort params when the sort is the default", () => {
    expect(filesHref(clean, DEFAULT_FILE_SORT, 1, 25)).toBe(
      "/dashboard/files?pageSize=25",
    );
  });

  it("encodes a non-default sort", () => {
    const sort: Sort<FileSortKey> = { key: "name", dir: "asc" };
    const url = new URL(filesHref(clean, sort, 1, 25), "http://x");
    expect(url.searchParams.get("sort")).toBe("name");
    expect(url.searchParams.get("dir")).toBe("asc");
  });

  it("encodes a non-default direction on the default key", () => {
    const url = new URL(
      filesHref(clean, { key: "createdAt", dir: "asc" }, 1, 25),
      "http://x",
    );
    expect(url.searchParams.get("sort")).toBe("createdAt");
    expect(url.searchParams.get("dir")).toBe("asc");
  });

  it("keeps filters and pagination alongside the sort", () => {
    const url = new URL(
      filesHref(
        { q: "report", tags: ["photos"], mode: "any" },
        { key: "size", dir: "desc" },
        2,
        50,
      ),
      "http://x",
    );
    expect(url.searchParams.get("q")).toBe("report");
    expect(url.searchParams.get("tags")).toBe("photos");
    expect(url.searchParams.get("sort")).toBe("size");
    expect(url.searchParams.get("dir")).toBe("desc");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("pageSize")).toBe("50");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
pnpm --filter web test -- file-filters
```

Expected: FAIL — `DEFAULT_FILE_SORT` is not exported / `filesHref` takes 3 args.

- [ ] **Step 3: Extend `apps/web/lib/file-filters.ts`**

Add the import at the top:

```ts
import type { Sort } from "@/lib/table-sort";
```

Add the sort constants near the top (after the `TagMode` type):

```ts
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
```

Replace `filesHref` with the sort-aware version:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter web test -- file-filters
```

Expected: PASS. (`check-types` will still fail until the call sites are updated in the next steps — that is expected.)

- [ ] **Step 5: Thread sort through `apps/web/components/files-filters.tsx`**

Extend the imports:

```tsx
import {
  type FileFilters,
  type FileSortKey,
  filesHref,
  hasActiveFilters,
  type TagMode,
} from "@/lib/file-filters";
import type { Sort } from "@/lib/table-sort";
```

Add `sort` to the props (so changing a filter never resets the ordering):

```tsx
export function FilesFilters({
  filters,
  sort,
  availableTags,
  pageSize,
}: {
  filters: FileFilters;
  sort: Sort<FileSortKey>;
  availableTags: string[];
  pageSize: number;
}) {
```

Then update the three `filesHref` calls inside the component to pass `sort` as the second argument:

- in the debounce effect: `router.replace(filesHref({ ...filters, q }, sort, 1, pageSize), { scroll: false });` — and add `sort` to that effect's dependency array.
- in `go`: `router.replace(filesHref(merged, sort, 1, pageSize), { scroll: false });`
- in the Clear button: `filesHref({ q: "", tags: [], mode: "any" }, sort, 1, pageSize)`

(Clear resets filters but **keeps** the current sort — clearing a search should not silently reorder the table.)

- [ ] **Step 6: Wire the Files page query + headers**

In `apps/web/app/dashboard/files/page.tsx`:

1. Extend the imports:

```ts
import { apiKeys, getDb, uploads } from "@repo/db";
import { and, asc, count, desc, eq, type SQL, sql } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
```

```ts
import { SortableHeader } from "@/components/sortable-header";
import {
  DEFAULT_FILE_SORT,
  escapeLike,
  type FileFilters,
  FILE_SORT_KEYS,
  type FileSortKey,
  filesHref,
  firstParam,
  hasActiveFilters,
  parseFileFilters,
} from "@/lib/file-filters";
import { nextDir, parseSort, type Sort, type SortDir } from "@/lib/table-sort";
```

2. Add the ORDER BY builder above `selectPage`:

```ts
/**
 * ORDER BY for the requested sort. `name` is nullable, so NULLS LAST is
 * pinned in BOTH directions (Postgres defaults are asymmetric and would
 * float unnamed files to the top on a descending sort). Every ordering ends
 * with `id` as a stable tiebreaker: without it, ties in a non-unique column
 * let OFFSET pagination duplicate or skip rows across page boundaries.
 */
function orderFor(sort: Sort<FileSortKey>): SQL[] {
  const dir = sort.dir === "asc" ? asc : desc;
  // Spelled out per direction rather than interpolating the direction into
  // the fragment — no raw string ever reaches SQL.
  const nameOrder =
    sort.dir === "asc"
      ? sql`${uploads.name} ASC NULLS LAST`
      : sql`${uploads.name} DESC NULLS LAST`;
  const primary =
    sort.key === "name"
      ? nameOrder
      : sort.key === "size"
        ? dir(uploads.size)
        : dir(uploads.createdAt);
  return [primary, asc(uploads.id)];
}
```

3. Give `selectPage` the ordering:

```ts
function selectPage(
  db: ReturnType<typeof getDb>,
  where: SQL | undefined,
  sort: Sort<FileSortKey>,
  offset: number,
  limit: number,
) {
```

and replace its `.orderBy(desc(uploads.createdAt))` with:

```ts
    .orderBy(...orderFor(sort))
```

4. Extend the `searchParams` type with `sort?: string | string[]; dir?: string | string[];`, and parse it right after `const filters = parseFileFilters(params);`:

```ts
  const sort = parseSort(params, FILE_SORT_KEYS, DEFAULT_FILE_SORT);
```

5. Pass `sort` to **both** `selectPage` calls (the main one and the clamped retry):

```ts
  let files = await selectPage(
    db,
    where,
    sort,
    (requestedPage - 1) * pageSize,
    pageSize,
  );
```

```ts
    files =
      total === 0
        ? files
        : await selectPage(db, where, sort, (page - 1) * pageSize, pageSize);
```

6. Add a header-href helper after `const filtered = hasActiveFilters(filters);`:

```ts
  // Sorting resets to page 1: a page number means nothing under a new order.
  const sortHref = (key: FileSortKey, defaultDir: SortDir) =>
    filesHref(filters, { key, dir: nextDir(sort, key, defaultDir) }, 1, pageSize);
```

7. Replace the three sortable `<TableHead>` elements (leave CID, Source, Tags and Open exactly as they are):

```tsx
                    <SortableHeader
                      label="Name"
                      href={sortHref("name", "asc")}
                      active={sort.key === "name"}
                      dir={sort.dir}
                    />
                    <TableHead>CID</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Tags</TableHead>
                    <SortableHeader
                      label="Size"
                      href={sortHref("size", "desc")}
                      active={sort.key === "size"}
                      dir={sort.dir}
                    />
                    <SortableHeader
                      label="Added"
                      href={sortHref("createdAt", "desc")}
                      active={sort.key === "createdAt"}
                      dir={sort.dir}
                    />
                    <TableHead className="text-right">Open</TableHead>
```

8. Pass `sort` to the filter bar and update the remaining `filesHref` call sites (the empty-state Clear link, the rows-per-page buttons, Previous and Next) to take `sort` as the second argument:

```tsx
          <FilesFilters
            filters={filters}
            sort={sort}
            availableTags={availableTags}
            pageSize={pageSize}
          />
```

```tsx
                  href={filesHref(
                    { q: "", tags: [], mode: "any" },
                    sort,
                    1,
                    pageSize,
                  )}
```

```tsx
                        render={<a href={filesHref(filters, sort, 1, size)} />}
```

```tsx
                          <a href={filesHref(filters, sort, page - 1, pageSize)} />
```

```tsx
                          <a href={filesHref(filters, sort, page + 1, pageSize)} />
```

- [ ] **Step 7: Gates + build**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
pnpm exec biome check --write apps/web
pnpm --filter web check-types
pnpm --filter web test
pnpm --filter web build
```

Expected: all clean; build compiles with `/dashboard/files` still dynamic. Verify with `grep -n "filesHref(" apps/web` that **no** call site passes only three arguments.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/file-filters.ts apps/web/lib/file-filters.test.ts apps/web/components/files-filters.tsx "apps/web/app/dashboard/files/page.tsx"
git commit -m "feat(web): sortable Name/Size/Added columns on the Files page"
```

---

### Task 4: Folders page sorting (in-memory)

**Files:**
- Modify: `apps/web/app/dashboard/folders/page.tsx`

**Interfaces:**
- Consumes: `parseSort`, `nextDir`, `sortFolders`, `Sort`, `SortDir`, `FolderSortKey` (Task 1); `SortableHeader` (Task 2); `getFolders(): Promise<FolderSummary[]>` where `FolderSummary = { name: string; rootCid: string; ipnsName: string | null; size: number; tags: string[] }`.
- Produces: nothing downstream.

- [ ] **Step 1: Add sorting to `apps/web/app/dashboard/folders/page.tsx`**

Add the imports:

```ts
import { SortableHeader } from "@/components/sortable-header";
import {
  type FolderSortKey,
  nextDir,
  parseSort,
  type Sort,
  type SortDir,
  sortFolders,
} from "@/lib/table-sort";
```

Add the constants after `export const dynamic = "force-dynamic";`:

```ts
const FOLDER_SORT_KEYS: readonly FolderSortKey[] = ["name", "size"] as const;
/** Alphabetical by default — MFS listing order is not guaranteed. */
const DEFAULT_FOLDER_SORT: Sort<FolderSortKey> = { key: "name", dir: "asc" };

function foldersHref(sort: Sort<FolderSortKey>): string {
  if (
    sort.key === DEFAULT_FOLDER_SORT.key &&
    sort.dir === DEFAULT_FOLDER_SORT.dir
  ) {
    return "/dashboard/folders";
  }
  return `/dashboard/folders?sort=${sort.key}&dir=${sort.dir}`;
}
```

Replace the component signature and data fetch:

```tsx
export default async function FoldersPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string | string[]; dir?: string | string[] }>;
}) {
  const params = await searchParams;
  const sort = parseSort(params, FOLDER_SORT_KEYS, DEFAULT_FOLDER_SORT);
  const folders = sortFolders(await getFolders(), sort);

  const sortHref = (key: FolderSortKey, defaultDir: SortDir) =>
    foldersHref({ key, dir: nextDir(sort, key, defaultDir) });
```

Replace the Name and Size headers (leave Tags, Links and Delete unchanged):

```tsx
                <TableRow>
                  <SortableHeader
                    label="Name"
                    href={sortHref("name", "asc")}
                    active={sort.key === "name"}
                    dir={sort.dir}
                  />
                  <TableHead>Tags</TableHead>
                  <SortableHeader
                    label="Size"
                    href={sortHref("size", "desc")}
                    active={sort.key === "size"}
                    dir={sort.dir}
                  />
                  <TableHead>Links</TableHead>
                  <TableHead className="text-right">Delete</TableHead>
                </TableRow>
```

- [ ] **Step 2: Gates + build**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
pnpm exec biome check --write apps/web
pnpm --filter web check-types
pnpm --filter web test
pnpm --filter web build
```

Expected: all clean; build compiles with `/dashboard/folders` still dynamic.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/dashboard/folders/page.tsx"
git commit -m "feat(web): sortable Name/Size columns on the Folders page"
```

---

### Task 5: Live SQL-layer verification

**Files:** none (verification only; commit fixes only if issues surface).

- [ ] **Step 1: Full gates**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
pnpm --filter web test
pnpm --filter web check-types
pnpm exec biome check apps/web
pnpm --filter web build
```

- [ ] **Step 2: Verify the ORDER BY properties against real Postgres**

The dashboard requires a session, so verify at the SQL layer with a throwaway
`tsx` script run inside `apps/web` (it has `@repo/db` and dev-default env),
exactly as the Files filter work was verified. Seed rows with a
recognisable CID prefix (e.g. `bafySORTTEST`) covering:

- three rows sharing the **same name** (`dup.txt`) — for the tiebreaker check
- one row with a **NULL** name
- assorted sizes and `created_at` values

Then confirm:

1. **NULLS LAST both ways** — order by name `ASC NULLS LAST` and
   `DESC NULLS LAST`; the NULL-named row is last in *both* results.
2. **Tiebreaker prevents page drift** — order by name with the `id`
   tiebreaker, take `LIMIT 2 OFFSET 0` then `LIMIT 2 OFFSET 2`; the four
   returned ids are distinct (no duplicates, nothing skipped). Repeat
   *without* the tiebreaker to observe that this is a real risk, and record
   both outputs in the report.
3. **Size and createdAt** order correctly in both directions.

Clean up: delete the seeded rows by CID prefix, remove the temp script.

- [ ] **Step 3: Hand off**

When green, use superpowers:finishing-a-development-branch for
`feat/sort-by-name` (PR to `main`). Note in the PR that browser interaction
(clicking headers, arrow indicators, `aria-sort`) was not exercised if no
browser is available.
