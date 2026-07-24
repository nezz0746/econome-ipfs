# Files Page: Search + Tag Filter

**Date:** 2026-07-21
**Status:** Approved

## Goal

Make the Files page searchable and filterable. Today it is a flat,
date-ordered, paginated list — finding a specific file means paging through
it. Add a name search and tag filtering, both server-side so they work across
the whole table rather than the current page.

## Decisions (locked)

| Question | Decision |
|---|---|
| Multi-tag semantics | **Toggle**: an Any/All switch (`mode=any` default, `mode=all`). |
| Search target | **File name only.** Not CID, not source label. |
| Filtering location | **Server-side in SQL.** Client-side would only filter the ~25 rows on screen. |
| State location | **URL query params** — shareable, bookmarkable, back-button friendly, consistent with existing pagination. |
| Rejected | Postgres full-text search (`tsvector` doesn't do infix substring matching well); client-side filtering (breaks with pagination). |

## URL contract

```
/dashboard/files?q=<text>&tags=a,b&mode=any|all&page=1&pageSize=25
```

- `q` — trimmed; empty/whitespace means "no search".
- `tags` — comma-separated slugs, parsed with the existing `parseTags` helper
  (`apps/web/lib/tags.ts`); invalid input is treated as no tag filter rather
  than erroring.
- `mode` — `any` (default) or `all`. Any other value falls back to `any`.
- **Any filter change resets `page` to 1.**

## Architecture

### 1. Pure filter module — `apps/web/lib/file-filters.ts` (new)

All parsing and query-string building lives here, free of React and Drizzle
so it is unit-testable:

```ts
export interface FileFilters { q: string; tags: string[]; mode: "any" | "all" }
export function parseFileFilters(params: {
  q?: string; tags?: string; mode?: string;
}): FileFilters
/** Escape LIKE wildcards so a literal % or _ typed by the user matches itself. */
export function escapeLike(value: string): string
/** Build the files href preserving every filter + pagination param. */
export function filesHref(
  filters: FileFilters,
  page: number,
  pageSize: number,
): string
export function hasActiveFilters(filters: FileFilters): boolean
```

`filesHref` omits default/empty values so a clean state produces a clean URL.

### 2. Page query — `apps/web/app/dashboard/files/page.tsx`

Build a `where` from the filters and apply it to **both** the page query and
the fallback count:

- `q` → `ilike(uploads.name, '%' + escapeLike(q) + '%')`. `name` is nullable;
  NULL names simply do not match, which is correct.
- `tags`, `mode=any` → array overlap: `uploads.tags && ARRAY[...]`
- `tags`, `mode=all` → array contains: `uploads.tags @> ARRAY[...]`

**Two existing behaviours must be updated, not just extended:**

1. `pageHref(page, pageSize)` currently encodes only page/pageSize — replaced
   by `filesHref(filters, page, pageSize)` everywhere (prev/next and the
   rows-per-page buttons), otherwise paginating silently drops the filters.
2. The out-of-range fallback runs `select count() from uploads` with **no**
   filter. It must apply the same `where`, or the clamp-to-last-page maths
   is computed against the wrong total when filtering.

### 3. Available tags

A separate small query for the chip list:

```sql
SELECT DISTINCT unnest(tags) AS tag FROM uploads ORDER BY tag
```

Only tags actually present on files are offered — no hardcoded list, nothing
stale. Runs on every page render; trivial at current row counts.

### 4. Filter UI — `apps/web/components/files-filters.tsx` (new, client)

Rendered above the table inside the existing Card. Props:
`{ filters: FileFilters; availableTags: string[]; pageSize: number }`.

- **Search input** — controlled, debounced ~300ms, then
  `router.replace(href, { scroll: false })` so the page does not jump on each
  keystroke. Seeded from `filters.q`.
- **Tag chips** — one per available tag, toggling on click; selected chips
  visually active (reuse the existing `TagBadges` styling vocabulary).
- **Any/All switch** — rendered **only when 2+ tags are selected** (it is
  meaningless for 0–1).
- **Clear** button — visible only when `hasActiveFilters(filters)`.

All controls navigate by building a `filesHref` with `page` reset to 1.

### 5. Empty states

Distinguish the two cases — a filtered-to-nothing view must not look like
data loss:

- No rows and no active filters → existing copy ("No files yet…").
- No rows with active filters → "No files match these filters." plus a
  clear-filters link.

The existing `1–25 of N` counter needs no change: it already derives from the
query total, which is now the filtered total.

## Testing

Unit tests (`apps/web/lib/file-filters.test.ts`, vitest — the web app already
runs `lib/**/*.test.ts`):

- `parseFileFilters`: defaults; whitespace-only `q` → empty; invalid `mode` →
  `any`; invalid tag input → no tag filter; tag dedupe/lowercasing via
  `parseTags`.
- `escapeLike`: `%`, `_`, and backslash escaped; ordinary text untouched.
- `filesHref`: round-trips through `parseFileFilters`; omits empty params;
  encodes multi-tag and `mode` correctly.
- `hasActiveFilters`: true for each filter kind, false for a clean state.

Page behaviour is verified by gates + `pnpm --filter web build`, per repo
convention (no page unit tests exist).

## Out of scope

- Searching CID or source label (name only, by decision).
- Saved/named filters.
- A GIN index on `uploads.tags` or a trigram index for `ILIKE`. At current
  row counts a sequential scan is fine; add indexes when there is a measured
  problem, not before.
- Sorting controls (still `created_at DESC`).
