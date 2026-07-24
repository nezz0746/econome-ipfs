# Sortable Columns: Files + Folders

**Date:** 2026-07-21
**Status:** Approved

## Goal

Let users order the Files and Folders tables by clicking column headers.
Files is SQL-backed and paginated, so sorting must happen in `ORDER BY` and
span the whole filtered set; Folders is an in-memory array from the API's MFS
listing, so it sorts with a comparator. Same UI, two implementations.

## Decisions (locked)

| Question | Decision |
|---|---|
| Sortable columns | **Files**: Name, Size, Added. **Folders**: Name, Size. |
| Not sortable | CID, Source, Tags, Links (array/opaque ordering is not meaningful). |
| Files default | **Unchanged — `Added` descending** (newest first). Name sorting is opt-in. |
| Folders default | **Name ascending** (today the order is whatever MFS returns, which is not guaranteed). |
| First-click direction | Per column: Name → `asc`, Size → `desc`, Added → `desc`. Clicking the active column flips it. |
| Header interaction | Plain links, rendered server-side. No client JS needed. |
| Page reset | Any sort change resets to page 1. |
| Sort vs filter | A non-default sort is **not** an active filter — `hasActiveFilters` is untouched, so sorting never lights up Clear or the "no files match" empty state. |

## Architecture

### 1. Pure module — `apps/web/lib/table-sort.ts` (new)

```ts
export type SortDir = "asc" | "desc";
export interface Sort<K extends string> { key: K; dir: SortDir }

/**
 * Parse sort params against an allow-list. Unknown keys or directions fall
 * back rather than throwing — a hand-edited URL must not error the page.
 */
export function parseSort<K extends string>(
  params: { sort?: string | string[]; dir?: string | string[] },
  allowed: readonly K[],
  fallback: Sort<K>,
): Sort<K>;

/** Direction a header click produces: same key flips, a new key uses its natural default. */
export function nextDir<K extends string>(
  current: Sort<K>,
  key: K,
  defaultDir: SortDir,
): SortDir;
```

Reuses the existing `firstParam` helper from `lib/file-filters.ts` for
array-valued query params.

### 2. Shared UI — `apps/web/components/sortable-header.tsx` (new)

A **server component** rendering a `<TableHead>` whose content is a link:

```ts
{ label: string; href: string; active: boolean; dir: SortDir; align?: "left" | "right" }
```

- Arrow icon: `ArrowUp`/`ArrowDown` when active, a muted `ArrowUpDown` when not.
- `aria-sort="ascending" | "descending" | "none"` on the `<TableHead>`.
- No client JS: the href is computed server-side, and filters already live in
  the URL, so a plain link preserves the full state.

### 3. Files page — `apps/web/app/dashboard/files/page.tsx`

- Sort keys: `"name" | "size" | "createdAt"`; default `{ key: "createdAt", dir: "desc" }`.
- URL params `sort`/`dir` alongside the existing `q`/`tags`/`mode`/`page`/`pageSize`.
- `filesHref` (in `lib/file-filters.ts`) gains a sort argument:
  `filesHref(filters, sort, page, pageSize)`. It omits `sort`/`dir` when they
  equal the default, keeping clean URLs. **All 6 call sites** update, and the
  `FilesFilters` client component receives the current sort as a prop so
  changing a filter never resets the ordering.
- `ORDER BY` rules:
  - `name` is **nullable** → pin `NULLS LAST` explicitly in *both* directions,
    so unnamed files never float to the top on a descending sort (Postgres's
    default is asymmetric: ASC→NULLS LAST, DESC→NULLS FIRST).
  - **Every ordering ends with `uploads.id` as a stable tiebreaker.** With
    OFFSET pagination, ties in a non-unique sort column let rows duplicate or
    disappear across page boundaries. This is a correctness requirement, not
    polish.

### 4. Folders page — `apps/web/app/dashboard/folders/page.tsx`

- Sort keys: `"name" | "size"`; default `{ key: "name", dir: "asc" }`.
- The page currently takes no props — it gains `searchParams`.
- A pure comparator, `sortFolders(folders, sort)`, colocated in
  `lib/table-sort.ts`'s consumer or in the page; it must be exported and pure
  so it is unit-testable. Name uses `localeCompare` (accented names sort
  correctly for French content); size is numeric.
- `foldersHref(sort)` builds the header links, omitting defaults.

## Testing

`apps/web/lib/table-sort.test.ts` (vitest picks up `lib/**/*.test.ts`):

- `parseSort`: defaults with no params; unknown `sort` key → fallback; invalid
  `dir` → fallback direction; valid key+dir round-trips; array-valued params
  (`?sort=a&sort=b`) take the first via `firstParam`.
- `nextDir`: same key flips `asc`↔`desc`; different key returns that column's
  natural default regardless of the current direction.
- `sortFolders`: name ascending/descending; size ascending/descending;
  accented names (`Élan` vs `Zebra`) ordered via `localeCompare`, not raw
  code points; equal values preserve a stable order.

Files `ORDER BY` is verified by gates plus a live SQL-layer check: seed rows
with duplicate names, confirm the `id` tiebreaker yields no duplicated or
skipped rows across two consecutive pages, and confirm NULL names sort last
in both directions.

## Out of scope

- Sorting CID, Source or Tags.
- Multi-column sort.
- Persisting a sort preference across sessions (URL only).
- Indexes for the new sort columns — at current row counts the planner is
  fine; revisit when measured.
