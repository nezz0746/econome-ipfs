import { describe, expect, it } from "vitest";
import type { EnrichedPeer } from "@/lib/api";
import { groupByLocation, initials, tagColor } from "@/lib/peer-map";

describe("tagColor", () => {
  it("is deterministic for the same tag", () => {
    expect(tagColor("media")).toBe(tagColor("media"));
  });

  it("differs across distinct tags and is an hsl() string", () => {
    expect(tagColor("media")).toMatch(/^hsl\(/);
    expect(tagColor("media")).not.toBe(tagColor("docs"));
  });
});

describe("initials", () => {
  it("takes the first letter of the first two words", () => {
    expect(initials("nezzar kefif")).toBe("NK");
    expect(initials("nezzar_kefif")).toBe("NK");
  });

  it("uses the first two chars for a single word", () => {
    expect(initials("media")).toBe("ME");
  });

  it("falls back to the id when the name is empty", () => {
    expect(initials("", "12D3KooWabc")).toBe("12");
  });

  it("returns a placeholder when nothing is available", () => {
    expect(initials("", "")).toBe("?");
  });
});

function makePeer(overrides: Partial<EnrichedPeer>): EnrichedPeer {
  return {
    id: "id",
    peername: "",
    online: true,
    publicIp: null,
    geo: null,
    bytesHeld: 0,
    fileCount: 0,
    subscribedTags: [],
    firstSeenAt: null,
    lastSeenAt: null,
    onlineSince: null,
    ...overrides,
  };
}

function geo(lat: number, lon: number, city = "City") {
  return {
    ip: "1.2.3.4",
    countryCode: "FR",
    country: "France",
    city,
    lat,
    lon,
  };
}

describe("groupByLocation", () => {
  it("buckets co-located peers into one group", () => {
    const { groups, unlocated } = groupByLocation([
      makePeer({ id: "a", geo: geo(48.85, 2.35) }),
      makePeer({ id: "b", geo: geo(48.85, 2.35) }),
    ]);
    expect(unlocated).toHaveLength(0);
    expect(groups).toHaveLength(1);
    expect(groups[0].peers.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("separates distinct locations and collects peers without geo", () => {
    const { groups, unlocated } = groupByLocation([
      makePeer({ id: "a", geo: geo(48.85, 2.35) }),
      makePeer({ id: "b", geo: geo(51.5, -0.13) }),
      makePeer({ id: "c", geo: null }),
    ]);
    expect(groups).toHaveLength(2);
    expect(unlocated.map((p) => p.id)).toEqual(["c"]);
  });
});
