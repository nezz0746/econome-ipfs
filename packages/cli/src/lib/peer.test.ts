import { describe, expect, it, vi } from "vitest";
import { parsePeerId, pollPeerId } from "./peer";

describe("parsePeerId", () => {
  it("reads the id field from cluster-ctl JSON", () => {
    expect(parsePeerId('{"id":"12D3KooWAbc","version":"1.0"}')).toBe(
      "12D3KooWAbc",
    );
  });

  it("returns null on empty or unparseable output", () => {
    expect(parsePeerId("")).toBeNull();
    expect(parsePeerId("connection refused")).toBeNull();
  });
});

describe("pollPeerId", () => {
  it("retries until an id appears", async () => {
    const getStdout = vi
      .fn()
      .mockResolvedValueOnce("") // daemon not ready
      .mockRejectedValueOnce(new Error("exec failed")) // container starting
      .mockResolvedValueOnce('{"id":"12D3KooWReady"}');
    const id = await pollPeerId(getStdout, { attempts: 5, delayMs: 0 });
    expect(id).toBe("12D3KooWReady");
    expect(getStdout).toHaveBeenCalledTimes(3);
  });

  it("returns null after exhausting attempts", async () => {
    const getStdout = vi.fn().mockResolvedValue("");
    const id = await pollPeerId(getStdout, { attempts: 3, delayMs: 0 });
    expect(id).toBeNull();
    expect(getStdout).toHaveBeenCalledTimes(3);
  });
});
