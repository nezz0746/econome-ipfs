import { describe, expect, it } from "vitest";
import { initials, tagColor } from "@/lib/peer-map";

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
