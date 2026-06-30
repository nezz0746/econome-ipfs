import { afterEach, describe, expect, it, vi } from "vitest";
import { registerPeer } from "./register";

afterEach(() => vi.restoreAllMocks());

describe("registerPeer", () => {
  it("POSTs the peer id to the register endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await registerPeer("https://host", "onb_x", "12D3KooWAbc");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://host/join/onb_x/register",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ peerId: "12D3KooWAbc" }),
      }),
    );
  });

  it("throws when the server rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        json: async () => ({ error: "no" }),
      })) as unknown as typeof fetch,
    );
    await expect(registerPeer("https://host", "onb_x", "p")).rejects.toThrow();
  });
});
