import { describe, expect, it } from "vitest";
import { extractPublicIp } from "../src/net";

describe("extractPublicIp", () => {
  it("returns the first public IPv4, skipping loopback and private ranges", () => {
    const addrs = [
      "/ip4/127.0.0.1/tcp/9096",
      "/ip4/172.22.0.4/tcp/9096",
      "/ip4/10.0.1.146/tcp/4001",
      "/ip4/51.83.32.120/tcp/4001",
    ];
    expect(extractPublicIp(addrs)).toBe("51.83.32.120");
  });

  it("falls back to a public IPv6 when no public IPv4 exists", () => {
    expect(
      extractPublicIp(["/ip6/::1/tcp/4001", "/ip6/2a01:cb00::1/tcp/4001"]),
    ).toBe("2a01:cb00::1");
  });

  it("returns null when only private/loopback addresses exist", () => {
    expect(
      extractPublicIp(["/ip4/192.168.1.5/tcp/4001", "/ip4/127.0.0.1/tcp/4001"]),
    ).toBe(null);
  });

  it("returns null for empty input", () => {
    expect(extractPublicIp([])).toBe(null);
  });
});
