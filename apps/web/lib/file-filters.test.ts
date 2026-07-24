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
