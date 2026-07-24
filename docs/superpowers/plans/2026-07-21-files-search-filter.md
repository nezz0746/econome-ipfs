# Files Page Search + Tag Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add name search and tag filtering (Any/All) to the Files page, filtered server-side in SQL and driven entirely by URL query params.

**Architecture:** A pure, unit-tested module (`lib/file-filters.ts`) owns param parsing, LIKE escaping and href building. The Files page (a server component) builds a Drizzle `where` from those filters and applies it to both the page query and the out-of-range fallback count. A small client component renders the search box, tag chips and Any/All switch, navigating by URL.

**Tech Stack:** Next.js App Router server components, Drizzle ORM (postgres-js driver), vitest, shadcn/ui (Badge, Button, Input).

**Spec:** `docs/superpowers/specs/2026-07-21-files-search-filter-design.md`

## Global Constraints

- Branch: `feat/files-search-filter` (off `main`; already created — work on it).
- URL contract: `/dashboard/files?q=<text>&tags=a,b&mode=any|all&page=1&pageSize=25`. `mode` defaults to `any`. **Any filter change resets `page` to 1.**
- Search matches **file name only** (case-insensitive substring). Not CID, not source.
- Multi-tag: `mode=any` → array overlap (`&&`); `mode=all` → array contains (`@>`).
- Filtering happens **in SQL**, never client-side over the current page.
- The same `where` must be applied to the page query **and** the fallback `count()`, or the clamp-to-last-page maths is wrong when filtering.
- `%`, `_` and `\` typed by the user must be escaped so they match literally.
- TypeScript strict + `noUncheckedIndexedAccess`. No page unit tests (repo convention) — `lib/**/*.test.ts` is what vitest picks up (see `apps/web/vitest.config.ts`).
- Gates per commit: `pnpm exec biome check --write apps/web`, `pnpm --filter web check-types`, `pnpm --filter web test`. Node ≥ 22 (`export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22`).
- Every commit message ends with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `lib/file-filters.ts` — pure param/href module (TDD)

**Files:**
- Create: `apps/web/lib/file-filters.ts`
- Test: `apps/web/lib/file-filters.test.ts`

**Interfaces:**
- Consumes: `parseTags` from `apps/web/lib/tags.ts` — signature `parseTags(input: unknown): string[] | null` (trims, lowercases, dedupes; returns `null` if any entry is not a valid slug matching `/^[a-z0-9][a-z0-9-]{0,31}$/`).
- Produces (used by Task 2):
  ```ts
  export type TagMode = "any" | "all";
  export interface FileFilters { q: string; tags: string[]; mode: TagMode }
  export function parseFileFilters(params: { q?: string; tags?: string; mode?: string }): FileFilters
  export function escapeLike(value: string): string
  export function hasActiveFilters(filters: FileFilters): boolean
  export function filesHref(filters: FileFilters, page: number, pageSize: number): string
  ```

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/file-filters.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  escapeLike,
  type FileFilters,
  filesHref,
  hasActiveFilters,
  parseFileFilters,
} from "./file-filters";

describe("parseFileFilters", () => {
  it("defaults to an empty, any-mode filter", () => {
    expect(parseFileFilters({})).toEqual({ q: "", tags: [], mode: "any" });
  });

  it("trims q and treats whitespace-only as empty", () => {
    expect(parseFileFilters({ q: "  report  " }).q).toBe("report");
    expect(parseFileFilters({ q: "   " }).q).toBe("");
  });

  it("parses, lowercases and dedupes tags", () => {
    expect(parseFileFilters({ tags: "Photos,archive,photos" }).tags).toEqual([
      "photos",
      "archive",
    ]);
  });

  it("treats invalid tag input as no tag filter", () => {
    // parseTags returns null for a non-slug entry; that must not throw.
    expect(parseFileFilters({ tags: "not a tag!" }).tags).toEqual([]);
  });

  it("accepts mode=all and falls back to any for anything else", () => {
    expect(parseFileFilters({ mode: "all" }).mode).toBe("all");
    expect(parseFileFilters({ mode: "ANY" }).mode).toBe("any");
    expect(parseFileFilters({ mode: "bogus" }).mode).toBe("any");
    expect(parseFileFilters({}).mode).toBe("any");
  });
});

describe("escapeLike", () => {
  it("escapes LIKE wildcards and backslashes", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("back\\slash")).toBe("back\\\\slash");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeLike("report 2026.pdf")).toBe("report 2026.pdf");
  });
});

describe("hasActiveFilters", () => {
  const base: FileFilters = { q: "", tags: [], mode: "any" };

  it("is false for a clean state", () => {
    expect(hasActiveFilters(base)).toBe(false);
  });

  it("is true when searching or filtering by tag", () => {
    expect(hasActiveFilters({ ...base, q: "x" })).toBe(true);
    expect(hasActiveFilters({ ...base, tags: ["photos"] })).toBe(true);
  });

  it("is false when only the mode differs (mode alone filters nothing)", () => {
    expect(hasActiveFilters({ ...base, mode: "all" })).toBe(false);
  });
});

describe("filesHref", () => {
  const clean: FileFilters = { q: "", tags: [], mode: "any" };

  it("omits empty filters and page 1", () => {
    expect(filesHref(clean, 1, 25)).toBe("/dashboard/files?pageSize=25");
  });

  it("encodes every active filter", () => {
    const href = filesHref(
      { q: "annual report", tags: ["photos", "archive"], mode: "all" },
      3,
      50,
    );
    const url = new URL(href, "http://x");
    expect(url.pathname).toBe("/dashboard/files");
    expect(url.searchParams.get("q")).toBe("annual report");
    expect(url.searchParams.get("tags")).toBe("photos,archive");
    expect(url.searchParams.get("mode")).toBe("all");
    expect(url.searchParams.get("page")).toBe("3");
    expect(url.searchParams.get("pageSize")).toBe("50");
  });

  it("round-trips through parseFileFilters", () => {
    const filters: FileFilters = {
      q: "rapport été",
      tags: ["photos", "archive"],
      mode: "all",
    };
    const url = new URL(filesHref(filters, 1, 25), "http://x");
    expect(
      parseFileFilters({
        q: url.searchParams.get("q") ?? undefined,
        tags: url.searchParams.get("tags") ?? undefined,
        mode: url.searchParams.get("mode") ?? undefined,
      }),
    ).toEqual(filters);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
pnpm --filter web test -- file-filters
```

Expected: FAIL — `Cannot find module './file-filters'`

- [ ] **Step 3: Implement `apps/web/lib/file-filters.ts`**

```ts
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
 * Parse the Files page query params into a filter state. Invalid input is
 * coerced to "no filter" rather than throwing: a hand-edited URL should show
 * unfiltered files, not an error page.
 */
export function parseFileFilters(params: {
  q?: string;
  tags?: string;
  mode?: string;
}): FileFilters {
  return {
    q: (params.q ?? "").trim(),
    // parseTags returns null when any entry is not a valid slug.
    tags: parseTags(params.tags) ?? [],
    mode: params.mode === "all" ? "all" : "any",
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter web test -- file-filters
```

Expected: PASS (all describe blocks). Then run the whole web suite — the 15 pre-existing tests must stay green:

```bash
pnpm --filter web test
```

- [ ] **Step 5: Gates + commit**

```bash
pnpm exec biome check --write apps/web
pnpm --filter web check-types
git add apps/web/lib/file-filters.ts apps/web/lib/file-filters.test.ts
git commit -m "feat(web): file filter parsing, LIKE escaping and href builder"
```

---

### Task 2: Filter UI component + Files page wiring

**Files:**
- Create: `apps/web/components/files-filters.tsx`
- Modify: `apps/web/app/dashboard/files/page.tsx`

**Interfaces:**
- Consumes: everything Task 1 produced (`FileFilters`, `parseFileFilters`, `escapeLike`, `hasActiveFilters`, `filesHref`, `TagMode`); existing `uploads`/`apiKeys` schema from `@repo/db`; `Badge`, `Button`, `Input` from `@/components/ui/*`.
- Produces: `export function FilesFilters({ filters, availableTags, pageSize }: { filters: FileFilters; availableTags: string[]; pageSize: number })`.
- Note: there is **no Switch primitive** in `apps/web/components/ui/` — build the Any/All toggle from two `Button`s, mirroring the existing rows-per-page button group.

- [ ] **Step 1: Create `apps/web/components/files-filters.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type FileFilters,
  filesHref,
  hasActiveFilters,
  type TagMode,
} from "@/lib/file-filters";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Search + tag filtering for the Files page. Navigates by URL so filters are
 * shareable and survive refresh; every change resets to page 1.
 */
export function FilesFilters({
  filters,
  availableTags,
  pageSize,
}: {
  filters: FileFilters;
  availableTags: string[];
  pageSize: number;
}) {
  const router = useRouter();
  const [q, setQ] = useState(filters.q);
  // Skip the debounce effect on mount and whenever the URL (not the user)
  // changed the value — otherwise landing on a filtered URL re-navigates.
  const lastPushed = useRef(filters.q);

  useEffect(() => {
    setQ(filters.q);
    lastPushed.current = filters.q;
  }, [filters.q]);

  useEffect(() => {
    if (q === lastPushed.current) return;
    const timer = setTimeout(() => {
      lastPushed.current = q;
      router.replace(filesHref({ ...filters, q }, 1, pageSize), {
        scroll: false,
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, filters, pageSize, router]);

  const go = (next: FileFilters) => {
    router.replace(filesHref(next, 1, pageSize), { scroll: false });
  };

  const toggleTag = (tag: string) => {
    const tags = filters.tags.includes(tag)
      ? filters.tags.filter((t) => t !== tag)
      : [...filters.tags, tag];
    go({ ...filters, tags });
  };

  const setMode = (mode: TagMode) => go({ ...filters, mode });

  const active = hasActiveFilters(filters);

  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name…"
          aria-label="Search files by name"
          className="h-8 w-full max-w-xs"
        />
        {active ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => {
              setQ("");
              lastPushed.current = "";
              go({ q: "", tags: [], mode: "any" });
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>

      {availableTags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Tags</span>
          {availableTags.map((tag) => {
            const selected = filters.tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                aria-pressed={selected}
                className="cursor-pointer"
              >
                <Badge
                  variant={selected ? "default" : "outline"}
                  className="font-mono text-xs"
                >
                  {tag}
                </Badge>
              </button>
            );
          })}

          {/* An any/all choice is only meaningful with 2+ tags selected. */}
          {filters.tags.length > 1 ? (
            <div className="ml-2 flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Match</span>
              <Button
                variant={filters.mode === "any" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2"
                onClick={() => setMode("any")}
              >
                Any
              </Button>
              <Button
                variant={filters.mode === "all" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2"
                onClick={() => setMode("all")}
              >
                All
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Rewrite the query layer in `apps/web/app/dashboard/files/page.tsx`**

Replace the import block's drizzle line and add the new imports:

```ts
import { apiKeys, getDb, uploads } from "@repo/db";
import { and, count, desc, eq, type SQL, sql } from "drizzle-orm";
import { ExternalLink } from "lucide-react";

import { CopyButton } from "@/components/copy-button";
import { FilesFilters } from "@/components/files-filters";
import { PageHeader } from "@/components/page-header";
import { TagBadges } from "@/components/tag-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  escapeLike,
  type FileFilters,
  filesHref,
  hasActiveFilters,
  parseFileFilters,
} from "@/lib/file-filters";
import { timeAgo } from "@/lib/format";
```

Delete the `pageHref` function (lines 40–42) — `filesHref` replaces it. Add the where-builder above `selectPage`:

```ts
/**
 * SQL predicate for the active filters, or undefined when unfiltered. Applied
 * to BOTH the page query and the fallback count so pagination maths matches
 * the filtered set.
 */
function buildWhere(filters: FileFilters): SQL | undefined {
  const clauses: SQL[] = [];

  if (filters.q) {
    // Explicit ESCAPE pairs with escapeLike() so a literal % or _ matches itself.
    clauses.push(
      sql`${uploads.name} ILIKE ${`%${escapeLike(filters.q)}%`} ESCAPE '\\'`,
    );
  }

  if (filters.tags.length > 0) {
    const tagArray = sql`ARRAY[${sql.join(
      filters.tags.map((tag) => sql`${tag}`),
      sql`, `,
    )}]::text[]`;
    clauses.push(
      filters.mode === "all"
        ? sql`${uploads.tags} @> ${tagArray}` // contains every selected tag
        : sql`${uploads.tags} && ${tagArray}`, // overlaps any selected tag
    );
  }

  return clauses.length === 0 ? undefined : and(...clauses);
}
```

Change `selectPage` to accept and apply the predicate:

```ts
function selectPage(
  db: ReturnType<typeof getDb>,
  where: SQL | undefined,
  offset: number,
  limit: number,
) {
  return db
    .select({
      id: uploads.id,
      cid: uploads.cid,
      name: uploads.name,
      size: uploads.size,
      tags: uploads.tags,
      // The API key that ingested the file — its label identifies the origin
      // client (one key per client: CMS, app, migration script, …).
      source: apiKeys.label,
      createdAt: uploads.createdAt,
      total: sql<number>`count(*) over()`.mapWith(Number),
    })
    .from(uploads)
    .leftJoin(apiKeys, eq(uploads.apiKeyId, apiKeys.id))
    .where(where)
    .orderBy(desc(uploads.createdAt))
    .limit(limit)
    .offset(offset);
}
```

- [ ] **Step 3: Wire filters through the page body**

Update the component signature and data fetching:

```tsx
export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    pageSize?: string;
    q?: string;
    tags?: string;
    mode?: string;
  }>;
}) {
  const params = await searchParams;

  const requestedSize = toInt(params.pageSize, DEFAULT_PAGE_SIZE);
  const pageSize = PAGE_SIZES.includes(
    requestedSize as (typeof PAGE_SIZES)[number],
  )
    ? requestedSize
    : DEFAULT_PAGE_SIZE;

  const filters = parseFileFilters(params);
  const where = buildWhere(filters);

  const db = getDb();
  const requestedPage = toInt(params.page, 1);

  // Tag chips offer exactly the tags present on files — never a stale list.
  const tagRows = await db
    .selectDistinct({ tag: sql<string>`unnest(${uploads.tags})` })
    .from(uploads);
  const availableTags = tagRows.map((row) => row.tag).sort();

  // Common path: fetch the requested page and its total in one round-trip.
  let files = await selectPage(
    db,
    where,
    (requestedPage - 1) * pageSize,
    pageSize,
  );
  let total: number;
  let page: number;

  const firstFile = files[0];
  if (firstFile) {
    // The window count rides along on every row, so any row carries the total.
    total = firstFile.total;
    page = requestedPage;
  } else {
    // Empty page — either nothing matches or the requested page is past the
    // end. Resolve the true (filtered) total, clamp to the last page, and
    // fetch it. Preserves the "out-of-range page shows the last page" behaviour.
    const [totalRow] = await db
      .select({ total: count() })
      .from(uploads)
      .where(where);
    total = totalRow?.total ?? 0;
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    page = Math.min(requestedPage, lastPage);
    files =
      total === 0
        ? files
        : await selectPage(db, where, (page - 1) * pageSize, pageSize);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const offset = (page - 1) * pageSize;
  const firstRow = total === 0 ? 0 : offset + 1;
  const lastRow = offset + files.length;
  const filtered = hasActiveFilters(filters);
```

- [ ] **Step 4: Render the filter bar, empty states and filter-preserving pagination**

Replace the `<Card>` body. The filter bar renders above the table and stays visible when a filter matches nothing (otherwise the user cannot undo it):

```tsx
      <Card>
        <CardContent>
          <FilesFilters
            filters={filters}
            availableTags={availableTags}
            pageSize={pageSize}
          />

          {total === 0 ? (
            filtered ? (
              <p className="text-sm text-muted-foreground">
                No files match these filters.{" "}
                <a
                  className="underline underline-offset-4"
                  href={filesHref({ q: "", tags: [], mode: "any" }, 1, pageSize)}
                >
                  Clear filters
                </a>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No files yet. Upload one from the Test Upload page or via the
                ingest API.
              </p>
            )
          ) : (
            <>
```

The table markup between `<>` and the pagination block is **unchanged**. In the pagination block, replace all four `pageHref(...)` calls with `filesHref(...)`:

```tsx
                    {PAGE_SIZES.map((size) => (
                      <Button
                        key={size}
                        variant={size === pageSize ? "secondary" : "ghost"}
                        size="sm"
                        className="h-7 px-2 tabular-nums"
                        render={<a href={filesHref(filters, 1, size)} />}
                      >
                        {size}
                      </Button>
                    ))}
```

```tsx
                    {page > 1 ? (
                      <Button
                        variant="outline"
                        size="sm"
                        render={<a href={filesHref(filters, page - 1, pageSize)} />}
                      >
                        Previous
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" disabled>
                        Previous
                      </Button>
                    )}
                    <span className="px-1 tabular-nums">
                      {page} / {totalPages}
                    </span>
                    {page < totalPages ? (
                      <Button
                        variant="outline"
                        size="sm"
                        render={<a href={filesHref(filters, page + 1, pageSize)} />}
                      >
                        Next
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" disabled>
                        Next
                      </Button>
                    )}
```

- [ ] **Step 5: Gates + build**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
pnpm exec biome check --write apps/web
pnpm --filter web check-types
pnpm --filter web test
pnpm --filter web build
```

Expected: biome clean, types clean, tests pass (15 pre-existing + the new file-filters suite), build compiles with `/dashboard/files` still dynamic.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/files-filters.tsx "apps/web/app/dashboard/files/page.tsx"
git commit -m "feat(web): search and tag-filter the Files page"
```

---

### Task 3: Live verification against the dev stack

**Files:** none (verification only; commit fixes only if the smoke surfaces issues).

- [ ] **Step 1: Start the stack**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
docker compose up -d           # postgres, kubo, cluster (skip if already running)
pnpm dev                       # api :8080 + web :3000, in the background
```

Seed a few uploads with differing names and tags via the Test Upload page (or the ingest API) so there is something to filter — at minimum: two files sharing one tag, one file with two tags, and one untagged.

- [ ] **Step 2: Verify each behaviour in the browser at `/dashboard/files`**

Confirm, in order:
1. Typing in the search box filters by name after ~300ms and does **not** jump the scroll position.
2. The URL updates to carry `q`; reloading that URL shows the same filtered view.
3. Clicking a tag chip filters to that tag; the chip renders as selected.
4. Selecting a second tag reveals the **Any / All** switch; `Any` widens the result set and `All` narrows it (use the file carrying both tags to tell them apart).
5. With a filter active, changing rows-per-page and clicking Previous/Next **keeps** the filter (check the URL retains `q`/`tags`/`mode`).
6. A search matching nothing shows "No files match these filters." with a working Clear link, and the filter bar stays visible.
7. `Clear` returns to the unfiltered list.
8. A name containing `%` or `_` searches literally (upload e.g. `100%_report.txt` and search `100%`).

- [ ] **Step 3: Tear down and hand off**

Kill the dev processes (`lsof -ti :3000 | xargs kill`, `lsof -ti :8080 | xargs kill`); leave docker running. When green, use superpowers:finishing-a-development-branch for `feat/files-search-filter` (PR to `main`).
