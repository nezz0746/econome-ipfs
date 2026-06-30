import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFollowerConfig } from "./config";

function mockFetch(body: unknown, ok = true) {
  return vi.fn(async () => ({
    ok,
    status: ok ? 200 : 400,
    json: async () => body,
  })) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchFollowerConfig", () => {
  it("returns the follower config on success", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        clusterName: "econome",
        compose: "services:\n",
        kuboInit: "#!/bin/sh\n",
      }),
    );
    const cfg = await fetchFollowerConfig("https://host/join/onb_x");
    expect(cfg.clusterName).toBe("econome");
    expect(cfg.compose).toContain("services:");
  });

  it("throws the server's error message", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ error: "this onboarding token has expired." }),
    );
    await expect(
      fetchFollowerConfig("https://host/join/onb_x"),
    ).rejects.toThrow("this onboarding token has expired.");
  });

  it("throws when the response is missing compose", async () => {
    vi.stubGlobal("fetch", mockFetch({ clusterName: "econome" }));
    await expect(
      fetchFollowerConfig("https://host/join/onb_x"),
    ).rejects.toThrow();
  });
});
