import { describe, expect, it } from "vitest";
import { parseJoinUrl } from "./join-url";

describe("parseJoinUrl", () => {
  it("splits a join URL into origin and token", () => {
    expect(parseJoinUrl("https://host.example/join/onb_abc123")).toEqual({
      origin: "https://host.example",
      token: "onb_abc123",
    });
  });

  it("tolerates a trailing slash", () => {
    expect(parseJoinUrl("https://host.example/join/onb_abc123/")).toEqual({
      origin: "https://host.example",
      token: "onb_abc123",
    });
  });

  it("throws on a URL without a /join/<token> path", () => {
    expect(() => parseJoinUrl("https://host.example/")).toThrow();
  });

  it("throws on non-URL input", () => {
    expect(() => parseJoinUrl("not a url")).toThrow();
  });
});
