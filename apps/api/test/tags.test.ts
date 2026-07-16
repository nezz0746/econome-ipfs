import { describe, expect, it } from "vitest";

import type { PinInfo } from "../src/cluster-client";
import {
  desiredAllocations,
  parseTags,
  planReallocations,
  type TagSubscription,
} from "../src/tags";

describe("parseTags", () => {
  it("returns [] for absent or empty input", () => {
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags(null)).toEqual([]);
    expect(parseTags("")).toEqual([]);
    expect(parseTags([])).toEqual([]);
    expect(parseTags(" , ,")).toEqual([]);
  });

  it("normalizes a comma-separated string", () => {
    expect(parseTags(" Photos, ARCHIVE ,photos")).toEqual([
      "photos",
      "archive",
    ]);
  });

  it("accepts an array of strings", () => {
    expect(parseTags(["a", "b-2"])).toEqual(["a", "b-2"]);
  });

  it("rejects invalid slugs and non-string entries", () => {
    expect(parseTags("not a slug")).toBeNull();
    expect(parseTags("-leading")).toBeNull();
    expect(parseTags("a".repeat(33))).toBeNull();
    expect(parseTags([1])).toBeNull();
    expect(parseTags({})).toBeNull();
  });
});

const subs: TagSubscription[] = [
  { peerId: "peer-b", subscribedTags: ["photos"] },
  { peerId: "peer-c", subscribedTags: ["videos", "photos"] },
  { peerId: "peer-d", subscribedTags: [] },
];

describe("desiredAllocations", () => {
  it("is the main peer plus subscribers of any of the tags", () => {
    expect(desiredAllocations(["photos"], "main", subs)).toEqual([
      "main",
      "peer-b",
      "peer-c",
    ]);
    expect(desiredAllocations(["videos"], "main", subs)).toEqual([
      "main",
      "peer-c",
    ]);
    expect(desiredAllocations(["other"], "main", subs)).toEqual(["main"]);
  });

  it("never duplicates the main peer", () => {
    const withMain = [...subs, { peerId: "main", subscribedTags: ["photos"] }];
    expect(desiredAllocations(["photos"], "main", withMain)).toEqual([
      "main",
      "peer-b",
      "peer-c",
    ]);
  });
});

function pin(overrides: Partial<PinInfo>): PinInfo {
  return {
    cid: "c1",
    name: "one",
    allocations: [],
    replicationFactorMin: 1,
    replicationFactorMax: 1,
    metadata: {},
    ...overrides,
  };
}

const allOnline = new Set(["main", "peer-b", "peer-c", "peer-d"]);

describe("planReallocations", () => {
  it("ignores untagged pins", () => {
    const pins = [pin({ allocations: [] })];
    expect(planReallocations(pins, subs, "main", allOnline)).toEqual([]);
  });

  it("re-pins when an online subscriber is missing (new subscriber)", () => {
    const pins = [
      pin({ metadata: { tags: "photos" }, allocations: ["main", "peer-b"] }),
    ];
    expect(planReallocations(pins, subs, "main", allOnline)).toEqual([
      {
        cid: "c1",
        name: "one",
        tags: ["photos"],
        allocations: ["main", "peer-b", "peer-c"],
      },
    ]);
  });

  it("does not re-pin while the missing subscriber is offline", () => {
    const pins = [
      pin({ metadata: { tags: "photos" }, allocations: ["main", "peer-b"] }),
    ];
    const online = new Set(["main", "peer-b"]); // peer-c offline
    expect(planReallocations(pins, subs, "main", online)).toEqual([]);
  });

  it("sheds extra peers (unsubscribed/substitutes) when all desired are online", () => {
    const pins = [
      pin({
        metadata: { tags: "videos" },
        allocations: ["main", "peer-c", "peer-d"], // peer-d no longer subscribed
      }),
    ];
    expect(planReallocations(pins, subs, "main", allOnline)).toEqual([
      {
        cid: "c1",
        name: "one",
        tags: ["videos"],
        allocations: ["main", "peer-c"],
      },
    ]);
  });

  it("tolerates extras while a desired peer is offline (avoids churn)", () => {
    const pins = [
      pin({
        metadata: { tags: "videos" },
        allocations: ["main", "peer-d"], // substitute while peer-c was offline
      }),
    ];
    const online = new Set(["main", "peer-d"]); // peer-c still offline
    expect(planReallocations(pins, subs, "main", online)).toEqual([]);
  });

  it("is a no-op when allocations already match", () => {
    const pins = [
      pin({
        metadata: { tags: "photos" },
        allocations: ["main", "peer-b", "peer-c"],
      }),
    ];
    expect(planReallocations(pins, subs, "main", allOnline)).toEqual([]);
  });
});
