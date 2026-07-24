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
    expect(
      parseSort({ sort: "name", dir: "asc" }, FILE_KEYS, FILE_FALLBACK),
    ).toEqual({ key: "name", dir: "asc" });
  });

  it("falls back entirely when the key is not allowed", () => {
    // An unknown key must not keep a user-supplied direction either.
    expect(
      parseSort({ sort: "cid", dir: "asc" }, FILE_KEYS, FILE_FALLBACK),
    ).toEqual(FILE_FALLBACK);
  });

  it("falls back to the fallback direction when dir is invalid", () => {
    expect(
      parseSort({ sort: "size", dir: "sideways" }, FILE_KEYS, FILE_FALLBACK),
    ).toEqual({ key: "size", dir: "desc" });
  });

  it("takes the first value of repeated params", () => {
    expect(
      parseSort(
        { sort: ["name", "size"], dir: ["asc", "desc"] },
        FILE_KEYS,
        FILE_FALLBACK,
      ),
    ).toEqual({ key: "name", dir: "asc" });
  });

  it("never throws on junk input", () => {
    expect(() =>
      parseSort({ sort: [], dir: [] }, FILE_KEYS, FILE_FALLBACK),
    ).not.toThrow();
    expect(parseSort({ sort: [], dir: [] }, FILE_KEYS, FILE_FALLBACK)).toEqual(
      FILE_FALLBACK,
    );
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
    expect(by({ key: "name", dir: "desc" })).toEqual([
      "zebra",
      "Élan",
      "apple",
    ]);
  });

  it("sorts by size", () => {
    expect(by({ key: "size", dir: "desc" })).toEqual([
      "Élan",
      "apple",
      "zebra",
    ]);
    expect(by({ key: "size", dir: "asc" })).toEqual(["zebra", "apple", "Élan"]);
  });

  it("does not mutate the input array", () => {
    const input = [
      { name: "b", size: 1 },
      { name: "a", size: 2 },
    ];
    sortFolders(input, { key: "name", dir: "asc" });
    expect(input.map((f) => f.name)).toEqual(["b", "a"]);
  });

  it("keeps equal values in their original order", () => {
    const ties = [
      { name: "first", size: 5 },
      { name: "second", size: 5 },
    ];
    expect(
      sortFolders(ties, { key: "size", dir: "asc" }).map((f) => f.name),
    ).toEqual(["first", "second"]);
  });
});
