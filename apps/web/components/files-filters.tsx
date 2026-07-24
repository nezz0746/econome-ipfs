"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type FileFilters,
  type FileSortKey,
  filesHref,
  hasActiveFilters,
  type TagMode,
} from "@/lib/file-filters";
import type { Sort } from "@/lib/table-sort";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Search + tag filtering for the Files page. Navigates by URL so filters are
 * shareable and survive refresh; every change resets to page 1.
 */
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
  const router = useRouter();
  const [q, setQ] = useState(filters.q);
  // Skip the debounce effect on mount and whenever the URL (not the user)
  // changed the value — otherwise landing on a filtered URL re-navigates.
  const lastPushed = useRef(filters.q);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Ignore the echo of our own navigation; only adopt genuinely external
    // changes (back/forward, hand-edited URL), which would otherwise clobber
    // characters typed while the server response was in flight. Compare
    // trimmed: the server echoes a trimmed q, so a trailing space typed
    // mid-phrase would otherwise be stripped from under the user.
    if (filters.q === lastPushed.current.trim()) return;
    setQ(filters.q);
    lastPushed.current = filters.q;
  }, [filters.q]);

  useEffect(() => {
    if (q === lastPushed.current) return;
    const timer = setTimeout(() => {
      lastPushed.current = q;
      router.replace(filesHref({ ...filters, q }, sort, 1, pageSize), {
        scroll: false,
      });
    }, SEARCH_DEBOUNCE_MS);
    timerRef.current = timer;
    return () => clearTimeout(timer);
  }, [q, filters, sort, pageSize, router]);

  // Every immediate (non-debounced) navigation must use the live local `q`
  // state, not the `filters` prop — otherwise clicking a tag chip or
  // Any/All right after typing (before the debounce fires) would navigate
  // with the stale pre-keystroke search term and momentarily drop it.
  const go = (next: FileFilters) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const merged = { ...next, q };
    lastPushed.current = q;
    router.replace(filesHref(merged, sort, 1, pageSize), { scroll: false });
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
              if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
              }
              setQ("");
              lastPushed.current = "";
              router.replace(
                filesHref({ q: "", tags: [], mode: "any" }, sort, 1, pageSize),
                { scroll: false },
              );
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
                aria-pressed={filters.mode === "any"}
                onClick={() => setMode("any")}
              >
                Any
              </Button>
              <Button
                variant={filters.mode === "all" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2"
                aria-pressed={filters.mode === "all"}
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
