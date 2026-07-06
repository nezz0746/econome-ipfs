import { describe, expect, it, vi } from "vitest";
import { parsePeerId, parsePinCount, pollPeerId } from "./peer";

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

describe("parsePinCount", () => {
  it("counts one entry per CID from `--enc=json status` output", () => {
    // The JSON form returns one GlobalPinInfo object per CID, regardless of how
    // many peers report on each CID.
    const json = JSON.stringify([
      { cid: "bafy1", peer_map: { peerA: {}, peerB: {} } },
      { cid: "bafy2", peer_map: { peerA: {}, peerB: {} } },
      { cid: "bafy3", peer_map: { peerA: {}, peerB: {} } },
    ]);
    expect(parsePinCount(json)).toBe(3);
  });

  it("does not over-count the way line-counting the text output did", () => {
    // Regression guard: plain-text `ipfs-cluster-ctl status` prints a CID
    // header line plus one line per peer, so counting lines reported ~3x the
    // real pin count (37 CIDs * 3 lines = 111). The JSON count stays honest.
    const entries = Array.from({ length: 37 }, (_, i) => ({
      cid: `bafy${i}`,
      peer_map: { peerA: {}, peerB: {} },
    }));
    expect(parsePinCount(JSON.stringify(entries))).toBe(37);
  });

  it("returns 0 for an empty pinset", () => {
    expect(parsePinCount("[]")).toBe(0);
  });

  it("returns 0 for non-array or unparseable output", () => {
    expect(parsePinCount("")).toBe(0);
    expect(parsePinCount("connection refused")).toBe(0);
    expect(parsePinCount('{"id":"not-a-list"}')).toBe(0);
  });
});
